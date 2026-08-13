/**
 * Registers each member credit batch as an Isometric `ProductionBatch` (issue
 * #630) so its MeasurementSamples can carry a real `production_batch_id`
 * instead of `null`.
 *
 * Server-internal core (no "use server" — it takes an explicit `orgCtx` and runs
 * inside the removal submit pipeline, which already resolved the caller). It
 * runs BEFORE the measurement-sample step: the registry needs the batch to exist
 * before a sample can point at it.
 *
 * ─── Idempotency + journaling ────────────────────────────────────────────────
 * A production batch is a physical artifact, not a per-submission payload, so
 * its supplier reference is keyed on the credit batch and never versioned. The
 * `certifier_production_batches` row is the journal: written on the same
 * confirmation that mints `ptb_…`, read first on every later attempt. When the
 * row is missing but the remote record exists (a crash between POST and INSERT,
 * a sandbox reset, a manual delete), `performRegistryCreate` reconciles by
 * supplier reference and claims the orphan instead of minting a duplicate —
 * `POST /production_batches` is not idempotent, so a blind re-POST would create
 * a second batch with the same reference.
 *
 * Conflicts fail loudly rather than silently repointing:
 *  - a remote record whose supplier reference is not ours,
 *  - a persisted registration whose external id differs from the one just
 *    confirmed (a concurrent registration won the race).
 *
 * Payload drift (mass or window changed after registration) is recorded as a
 * sync event and logged, not applied: the registry exposes no PATCH for a
 * production batch, so the registered figures stay authoritative until someone
 * resolves it in Isometric. Consistently with that, payload validation gates
 * only the batches that still need a POST — a registered batch whose local
 * facts have gone invalid is reused, never blocked.
 */

import {
  getProductionBatchRegistrations,
  getProductionBatchRegistryInputs,
  migrateProductionBatchPayloadHash,
  upsertProductionBatchRegistration,
  type ProductionBatchRegistryInput,
} from "@/data-access/certifier-production-batches";
import type { OrgContext } from "@/lib/auth/server";
import { MASS_COMPARISON_EPSILON_KG } from "@/lib/calculations/mass-dry";
import { SafeError } from "@/lib/errors";
import { getIsometricClientForOrg } from "@/lib/isometric/client";
import {
  buildCreateProductionBatchRequest,
  buildProductionBatchReference,
  createProductionBatch,
  findProductionBatchBySupplierRef,
  productionBatchMassUnitsMatch,
  type CreateProductionBatchRequest,
  type IsometricProductionBatch,
} from "@/lib/isometric/production-batches";
import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import type { Logger } from "@/lib/log";
import {
  applyProductionBatchIds,
  creditBatchIdsForMeasurementSamples,
  type DurabilityMeasurementSampleSubmission,
} from "./durability-measurement-samples";
import {
  performRegistryCreate,
  supplierRefLookup,
  type RegistryExternalMutationReporter,
} from "./registry-create";
import {
  appendSyncEventBestEffort,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
} from "./shared";

const LEGACY_DAY_START_SUFFIX = "T00:00:00.000Z";
const LEGACY_DAY_END_SUFFIX = "T23:59:59.999Z";

/** One credit batch's production-batch POST: its supplier ref + request body. */
export interface ProductionBatchSubmission {
  creditBatchId: string;
  creditBatchCode: string;
  supplierRefId: string;
  body: CreateProductionBatchRequest;
  /** Registered total dry mass (kg) — mirrored locally for readback. */
  massKg: number;
  startedOn: string;
  endedOn: string;
  payloadHash: string;
}

/**
 * Deterministic credit-batch-id order for the POST sequence and audit trail, so
 * neither depends on DB row order. Compares code units rather than
 * `localeCompare`, whose ICU collation varies with the runtime's locale data.
 */
function sortByCreditBatchId(
  inputs: ProductionBatchRegistryInput[],
): ProductionBatchRegistryInput[] {
  return [...inputs].sort((left, right) =>
    left.creditBatchId < right.creditBatchId
      ? -1
      : left.creditBatchId > right.creditBatchId
        ? 1
        : 0,
  );
}

/** Build one credit batch's submission. Pure; throws `SafeError` on bad data. */
export function buildProductionBatchSubmission(
  input: ProductionBatchRegistryInput,
): ProductionBatchSubmission {
  // A run that was never weighed would shrink `M_biochar (DM)` without a trace,
  // and the registry has no PATCH for a production batch, so the understated
  // mass claim would stand forever. Refuse rather than under-declare.
  if (input.runsMissingDryMass > 0) {
    throw new SafeError(
      `Credit batch ${input.creditBatchCode} has production runs with no dry biochar mass recorded. Record the produced mass on every run in the batch before submitting.`,
    );
  }
  if (input.runsMissingEndTime > 0) {
    throw new SafeError(
      `Credit batch ${input.creditBatchCode} has production runs that are still open. Close every run in the batch before submitting.`,
    );
  }
  const supplierRefId = buildProductionBatchReference({
    creditBatchId: input.creditBatchId,
  });
  const body = buildCreateProductionBatchRequest({
    creditBatchCode: input.creditBatchCode,
    externalFacilityId: input.externalFacilityId ?? "",
    feedstockTypeIds: input.isometricFeedstockTypeId
      ? [input.isometricFeedstockTypeId]
      : [],
    startedAt: input.startedAt ?? "",
    endedAt: input.endedAt ?? "",
    totalDryMassKg: input.totalDryMassKg,
    supplierReferenceId: supplierRefId,
  });
  return {
    creditBatchId: input.creditBatchId,
    creditBatchCode: input.creditBatchCode,
    supplierRefId,
    body,
    massKg: input.totalDryMassKg,
    startedOn: body.started_at.slice(0, 10),
    endedOn: body.ended_at.slice(0, 10),
    payloadHash: payloadHash(body),
  };
}

/**
 * Build the production-batch submissions for a set of credit batches. Pure
 * apart from its input list, and deterministic in credit-batch id order.
 */
export function buildProductionBatchSubmissions(
  inputs: ProductionBatchRegistryInput[],
): ProductionBatchSubmission[] {
  return sortByCreditBatchId(inputs).map(buildProductionBatchSubmission);
}

export interface EnsureProductionBatchesArgs {
  orgCtx: OrgContext;
  removalId: string;
  /** Claimed ledger row used for registry audit and recovery. */
  submissionRow: { id: string };
  expectedLockedAt?: Date;
  deferRejectionToAttempt?: boolean;
  onExternalMutation?: RegistryExternalMutationReporter;
  creditBatchIds: string[];
  log: Logger;
}

/**
 * Ensure every given credit batch has a registered Isometric production batch,
 * returning `creditBatchId → ptb_…`. Sequential so the audit-event ordering is
 * deterministic and a wide removal never bursts the connection pool.
 */
export async function ensureProductionBatchesForCreditBatches(
  args: EnsureProductionBatchesArgs,
): Promise<Map<string, string>> {
  const creditBatchIds = Array.from(new Set(args.creditBatchIds));
  const registeredByCreditBatchId = new Map<string, string>();
  if (creditBatchIds.length === 0) return registeredByCreditBatchId;

  const [inputs, existingRows] = await Promise.all([
    getProductionBatchRegistryInputs(args.orgCtx, creditBatchIds),
    getProductionBatchRegistrations(args.orgCtx, creditBatchIds),
  ]);
  const missing = creditBatchIds.filter(
    (id) => !inputs.some((input) => input.creditBatchId === id),
  );
  if (missing.length > 0) {
    throw new SafeError(
      "A credit batch in this Removal could not be read. Reload the Removal and submit again.",
    );
  }
  const existingByCreditBatchId = new Map(
    existingRows.map((row) => [row.creditBatchId, row]),
  );

  const client = await getIsometricClientForOrg(args.orgCtx.organizationId);

  // Payloads are built INSIDE the loop, per batch that still needs a POST: an
  // already-registered batch needs no payload, so local data that has since
  // drifted to invalid (facility mapping cleared, feedstock link removed, a
  // member run's mass edited away) must not block a resubmission of a batch the
  // registry already holds. Only batches that actually reach the registry are
  // validated.
  for (const input of sortByCreditBatchId(inputs)) {
    const existing = existingByCreditBatchId.get(input.creditBatchId);
    if (existing) {
      const current = tryBuildProductionBatchSubmission(input, args.log);
      if (current && current.payloadHash !== existing.payloadHash) {
        if (
          matchesLegacyDateBoundPayloadHash(
            input,
            current,
            existing.payloadHash,
          )
        ) {
          await migrateProductionBatchPayloadHash(args.orgCtx, {
            creditBatchId: input.creditBatchId,
            expectedPayloadHash: existing.payloadHash,
            nextPayloadHash: current.payloadHash,
          });
        } else {
          await recordProductionBatchDrift({
            orgCtx: args.orgCtx,
            removalId: args.removalId,
            submissionRowId: args.submissionRow.id,
            submission: current,
            registeredExternalId: existing.externalProductionBatchId,
            log: args.log,
          });
        }
      }
      registeredByCreditBatchId.set(
        input.creditBatchId,
        existing.externalProductionBatchId,
      );
      continue;
    }

    const submission = buildProductionBatchSubmission(input);
    let reconciledLegacyBatch: IsometricProductionBatch | null = null;
    const { externalId } = await performRegistryCreate({
      orgCtx: args.orgCtx,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: args.removalId,
      submissionRowId: args.submissionRow.id,
      expectedLockedAt: args.expectedLockedAt,
      deferRejectionToAttempt: args.deferRejectionToAttempt,
      operation: `production-batch:create:${submission.creditBatchId}`,
      requestPayload: submission.body,
      supplierRefId: submission.supplierRefId,
      // A missing journal row is exactly the "did the previous attempt reach
      // the registry?" unknown, regardless of whether THIS submission attempt
      // is a resume: a failed attempt can leave no journal while a new
      // submission version starts fresh with resumed=false. POST
      // /production_batches is not idempotent, so always reconcile by the
      // stable supplier reference before POSTing (#635).
      resumed: true,
      create: async () => {
        const batch = await createProductionBatch(client, submission.body);
        const mismatch = productionBatchMismatchMessage(batch, submission.body);
        if (mismatch) throw new SafeError(mismatch);
        return batch.id;
      },
      reconcile: async () => {
        const batch = await findProductionBatchBySupplierRef(
          client,
          submission.supplierRefId,
        );
        if (batch) {
          const mismatch = productionBatchMismatchMessage(
            batch,
            submission.body,
            input,
          );
          if (mismatch) return { found: "refused", message: mismatch };
          if (
            productionBatchWindowKind(batch, submission.body, input) ===
            "legacy"
          ) {
            reconciledLegacyBatch = batch;
          }
        }
        return supplierRefLookup(
          batch ? { found: true, externalId: batch.id } : { found: false },
        );
      },
      onConfirmed: async (confirmedId) => {
        const row = await upsertProductionBatchRegistration(args.orgCtx, {
          creditBatchId: submission.creditBatchId,
          externalProductionBatchId: confirmedId,
          supplierReference: submission.supplierRefId,
          externalProjectId: input.externalProjectId,
          externalFacilityId: input.externalFacilityId,
          massKg: submission.massKg,
          startedOn: submission.startedOn,
          endedOn: submission.endedOn,
          payloadHash: submission.payloadHash,
        });
        if (row.externalProductionBatchId !== confirmedId) {
          throw new SafeError(
            `Credit batch ${submission.creditBatchCode} is already registered as a different production batch in Isometric. Check the registry record before submitting again.`,
          );
        }
        if (reconciledLegacyBatch) {
          await recordLegacyProductionBatchClaim({
            orgCtx: args.orgCtx,
            removalId: args.removalId,
            submissionRowId: args.submissionRow.id,
            submission,
            batch: reconciledLegacyBatch,
          });
        }
      },
      failureMessagePrefix: `Registry production batch for credit batch ${submission.creditBatchCode} could not be created`,
      onExternalMutation: args.onExternalMutation,
      log: args.log,
    });
    registeredByCreditBatchId.set(submission.creditBatchId, externalId);
  }

  return registeredByCreditBatchId;
}

/**
 * The submit pipeline's single entry point: register (or reuse) the production
 * batch behind every per-batch measurement sample, then return the same
 * submissions with a real `production_batch_id` on each body. Called before the
 * measurement-sample POSTs — the registry needs the batch to exist first.
 */
export async function bindProductionBatchesToMeasurementSamples(args: {
  orgCtx: OrgContext;
  removalId: string;
  submissionRow: { id: string };
  expectedLockedAt?: Date;
  deferRejectionToAttempt?: boolean;
  onExternalMutation?: RegistryExternalMutationReporter;
  submissions: DurabilityMeasurementSampleSubmission[];
  log: Logger;
}): Promise<DurabilityMeasurementSampleSubmission[]> {
  const registered = await ensureProductionBatchesForCreditBatches({
    orgCtx: args.orgCtx,
    removalId: args.removalId,
    submissionRow: args.submissionRow,
    expectedLockedAt: args.expectedLockedAt,
    deferRejectionToAttempt: args.deferRejectionToAttempt,
    onExternalMutation: args.onExternalMutation,
    creditBatchIds: creditBatchIdsForMeasurementSamples(args.submissions),
    log: args.log,
  });
  return applyProductionBatchIds(args.submissions, registered);
}

/**
 * Rebuild an already-registered batch's payload for the drift comparison only.
 * A build failure here is data the registry never sees, so it is logged and the
 * registered record is reused — consistent with drift itself being recorded,
 * not applied.
 */
function tryBuildProductionBatchSubmission(
  input: ProductionBatchRegistryInput,
  log: Logger,
): ProductionBatchSubmission | null {
  try {
    return buildProductionBatchSubmission(input);
  } catch (err) {
    log.warn(
      {
        creditBatchId: input.creditBatchId,
        errorName: err instanceof Error ? err.name : typeof err,
      },
      "registered production batch could not be rebuilt for drift comparison; reusing the registered record",
    );
    return null;
  }
}

/**
 * Before physical member-run instants were submitted, noma encoded the same
 * date-only credit-batch window as UTC day-start/day-end timestamps. Treat a
 * stored hash of that exact legacy body as a representation migration rather
 * than permanent business-data drift. Any mass, facility, feedstock, kind or
 * supplier-reference change still produces a different hash and is reported.
 */
function matchesLegacyDateBoundPayloadHash(
  input: ProductionBatchRegistryInput,
  current: ProductionBatchSubmission,
  storedHash: string,
): boolean {
  const legacyBody: CreateProductionBatchRequest = {
    ...current.body,
    started_at: `${input.startDate}${LEGACY_DAY_START_SUFFIX}`,
    ended_at: `${input.endDate}${LEGACY_DAY_END_SUFFIX}`,
  };
  const physicalStartMs = Date.parse(current.body.started_at);
  const physicalEndMs = Date.parse(current.body.ended_at);
  const legacyStartMs = Date.parse(legacyBody.started_at);
  const legacyEndMs = Date.parse(legacyBody.ended_at);
  const physicalWindowFitsLegacyBounds =
    physicalStartMs >= legacyStartMs && physicalEndMs <= legacyEndMs;
  return (
    physicalWindowFitsLegacyBounds && payloadHash(legacyBody) === storedHash
  );
}

type LegacyProductionBatchWindow = Pick<
  ProductionBatchRegistryInput,
  "startDate" | "endDate"
>;

function timestampMatches(actual: string, expected: string): boolean {
  const actualMs = Date.parse(actual);
  return (
    Number.isFinite(actualMs) && actualMs === Date.parse(expected)
  );
}

function productionBatchMismatchMessage(
  batch: IsometricProductionBatch,
  expected: CreateProductionBatchRequest,
  legacyWindow?: LegacyProductionBatchWindow,
): string | null {
  const windowKind = productionBatchWindowKind(
    batch,
    expected,
    legacyWindow,
  );
  const sameFeedstocks =
    [...batch.feedstock_type_ids].sort().join("\u0000") ===
    [...expected.feedstock_type_ids].sort().join("\u0000");
  const massDifferenceKg = Math.abs(
    batch.mass.magnitude - expected.mass.magnitude,
  );
  const floatingPointSlackKg =
    Number.EPSILON *
    (Math.abs(batch.mass.magnitude) + Math.abs(expected.mass.magnitude));
  const massMagnitudeMatches =
    massDifferenceKg <=
    MASS_COMPARISON_EPSILON_KG + floatingPointSlackKg;
  if (
    batch.supplier_reference_id === expected.supplier_reference_id &&
    batch.facility_id === expected.facility_id &&
    sameFeedstocks &&
    batch.kind === expected.kind &&
    massMagnitudeMatches &&
    productionBatchMassUnitsMatch(batch.mass.unit, expected.mass.unit) &&
    windowKind !== "mismatch"
  ) {
    return null;
  }
  return `Registry production batch ${batch.id} does not match this credit batch's facility, feedstock, kind, mass, or production window. Ask support to check the registry record.`;
}

function productionBatchWindowKind(
  batch: IsometricProductionBatch,
  expected: CreateProductionBatchRequest,
  legacyWindow?: LegacyProductionBatchWindow,
): "physical" | "legacy" | "mismatch" {
  const physicalWindowMatches =
    timestampMatches(batch.started_at, expected.started_at) &&
    timestampMatches(batch.ended_at, expected.ended_at);
  if (physicalWindowMatches) return "physical";
  const legacyWindowMatches =
    legacyWindow !== undefined &&
    timestampMatches(
      batch.started_at,
      `${legacyWindow.startDate}${LEGACY_DAY_START_SUFFIX}`,
    ) &&
    timestampMatches(
      batch.ended_at,
      `${legacyWindow.endDate}${LEGACY_DAY_END_SUFFIX}`,
    );
  return legacyWindowMatches ? "legacy" : "mismatch";
}

async function recordLegacyProductionBatchClaim(args: {
  orgCtx: OrgContext;
  removalId: string;
  submissionRowId: string;
  submission: ProductionBatchSubmission;
  batch: IsometricProductionBatch;
}): Promise<void> {
  await appendSyncEventBestEffort(
    args.orgCtx,
    {
      provider: ISOMETRIC_PROVIDER,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: args.removalId,
      operation: `production-batch:legacy-window-claimed:${args.submission.creditBatchId}`,
      status: "succeeded",
      requestPayload: args.submission.body,
      responsePayload: {
        id: args.batch.id,
        supplier_reference_id: args.batch.supplier_reference_id,
        started_at: args.batch.started_at,
        ended_at: args.batch.ended_at,
      },
    },
    { submissionId: args.submissionRowId },
  );
}

async function recordProductionBatchDrift(args: {
  orgCtx: OrgContext;
  removalId: string;
  submissionRowId: string;
  submission: ProductionBatchSubmission;
  registeredExternalId: string;
  log: Logger;
}): Promise<void> {
  args.log.warn(
    {
      creditBatchId: args.submission.creditBatchId,
      productionBatchId: args.registeredExternalId,
    },
    "registered production batch differs from current batch data; reusing the registered record",
  );
  await appendSyncEventBestEffort(
    args.orgCtx,
    {
      provider: ISOMETRIC_PROVIDER,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: args.removalId,
      operation: `production-batch:drift:${args.submission.creditBatchId}`,
      status: "succeeded",
      requestPayload: args.submission.body,
      responsePayload: {
        id: args.registeredExternalId,
        supplier_reference_id: args.submission.supplierRefId,
        reused: true,
      },
    },
    { submissionId: args.submissionRowId },
  );
}
