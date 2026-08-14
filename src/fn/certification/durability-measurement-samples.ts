/**
 * Sampled 1000-year durability measurement-samples submission step.
 *
 * Server-internal core (no "use server" — it takes an explicit `orgCtx` and runs
 * inside the submit pipeline, which already resolved the caller). For each local
 * Sample it POSTs one `biochar_production_batch` measurement sample carrying
 * that Sample's paired chemistry evidence.
 * Measurement-sample response datapoints bind inputs declared with the
 * `measurement-property` source, including the 1000-year carbon and
 * `s_fraction` lists. Product mass is bound through a direct orchestrator
 * datapoint because it describes the credit batch, not a physical Sample.
 *
 * ─── ⚠️ SANDBOX ONLY — gated on `ISOMETRIC_ENVIRONMENT === "sandbox"` ─────────
 * Explicit binding is implemented for the verified 1000-year component. The
 * 200-year H/C unit scaling and property/input table remain unverified (see
 * `docs/open-questions.md`) and unsampled Method B remains post-MVP, so both
 * combinations fail closed even against the sandbox. Against PRODUCTION the
 * gate is `false` and `submitRemoval` hard-blocks any template that declares a
 * sequestration component, so this step never runs against the live registry.
 *
 * The POST choreography reuses `performRegistryCreate` (create → on failure
 * reconcile by supplier-ref lookup → audit event / ledger-reject), idempotent on
 * the versioned supplier reference, mirroring the datapoint/removal/sensor flows.
 */
import type { OrgContext } from "@/lib/auth/server";
import { appendSubmissionJournal } from "@/data-access/certification";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import { env } from "@/config/env";
import type { Logger } from "@/lib/log";
import { getIsometricClientForOrg } from "@/lib/isometric/client";
import type { IsometricClient } from "@/lib/isometric/client";
import { patchDatapoint } from "@/lib/isometric/submissions";
import {
  buildMeasurementSampleReference,
  captureMeasurementSampleDatapointIds,
  createMeasurementSample,
  findMeasurementSampleBySupplierRef,
  mergeMeasurementSampleDatapointIds,
  type CreateMeasurementSampleRequest,
  type IsometricMeasurementSample,
  type MeasurementSampleDatapointCapture,
} from "@/lib/isometric/measurement-samples";
import {
  build1000YearSequestrationSample,
  H_TO_C_ORG_MEASUREMENT_PROPERTY,
  INORGANIC_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
  INORGANIC_CARBON_MEASUREMENT_PROPERTY,
  S_FRACTION_MEASUREMENT_PROPERTY,
  TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
  TOTAL_CARBON_MEASUREMENT_PROPERTY,
} from "@/lib/isometric/transformers/measurement-sample";
import { SafeError } from "@/lib/errors";
import { evaluateSampled1000YearReplicates } from "@/lib/certification/durability-1000-replicates";
import {
  buildPerBatchDurabilityData,
  type FacilityReferenceSoilTemperature,
} from "@/lib/isometric/utils/durability-aggregation";
import {
  performRegistryCreate,
  supplierRefLookup,
  type RegistryExternalMutationReporter,
} from "./registry-create";
import { REMOVAL_ENTITY_TYPE } from "./shared";
import type { RemovalSourceBindingPlanEntry } from "@/lib/certification/removal-source-bindings";
import { encodeMeasurementProperty } from "@/lib/isometric/utils/measurement-property";
import {
  addJournaledMeasurementSample,
  readJournaledMeasurementSamples,
  type JournaledMeasurementSample,
} from "@/lib/certification/measurement-sample-journal";

/**
 * Sandbox-only gate for sampled 1000-year measurement-sample POSTs. Pointing an
 * environment at the Isometric SANDBOX is itself the opt-in — there is nothing
 * to protect there — so no separate flag is required. Against production this
 * stays false, and `submitRemoval` blocks every sequestration-template
 * submission, so checked-in code cannot create an emissions-only entry.
 */
export const DURABILITY_MEASUREMENT_SAMPLES_ENABLED =
  env.ISOMETRIC_ENVIRONMENT === "sandbox";

export const DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE =
  "Durability submission is not available in the production registry yet. Wait for support to confirm availability before submitting this Removal.";

/** One measurement-sample POST: its versioned supplier ref + the request body. */
export interface DurabilityMeasurementSampleSubmission {
  /** Stable business identities; operation keys are audit labels only. */
  creditBatchId: string;
  sampleId: string;
  /** Attribution-scaled mass transported separately as one direct Datapoint. */
  creditBatchProductMassKg: number;
  /** Sync-event operation suffix at local-Sample grain. */
  operationKey: string;
  supplierRefId: string;
  body: CreateMeasurementSampleRequest;
  /** Human label for logs / failure messages. */
  label: string;
  /** Ordered Sample identities for the paired replicate values in this body. */
  replicateSampleIds?: string[];
}

export interface BuildDurabilityMeasurementSampleSubmissionsArgs {
  removalId: string;
  /** Removal submission version — versions the supplier refs (supersede-safe). */
  version: number;
  externalProjectId: string;
  /** The removal's member credit batches with pooled Samples + applied runs. */
  batches: CreditBatchWithSamples[];
  /** Per-run applied-biochar fraction (scales each batch's product mass). */
  attributionByRunId: Map<string, number>;
  /** Retained in the shared claim shape; unused by sampled 1000-year submissions. */
  facilityReferenceSoilTemperature: FacilityReferenceSoilTemperature | null;
}

/**
 * The only durability capability approved for activation is sampled Method A
 * at 1000 years. Keep this assertion reusable so the orchestrator can reject
 * unsupported combinations before payload compilation while the builder
 * remains safe for any other server-side caller.
 */
export function assertSupportedDurabilityConfiguration(
  batches: Pick<CreditBatchWithSamples, "sampling" | "durabilityOption">[],
): void {
  if (batches.some((batch) => batch.sampling !== "sampled")) {
    throw new SafeError(
      "Unsampled Method B Removals cannot be submitted yet. Wait for support to confirm registry availability.",
    );
  }
  if (batches.some((batch) => batch.durabilityOption !== "1000_year")) {
    throw new SafeError(
      "200-year Removals cannot be submitted yet. Wait for support to confirm registry availability.",
    );
  }
}

/**
 * Builds one sampled 1000-year `biochar_production_batch` measurement sample
 * per local Sample. The activation slice is deliberately narrower than the transformers
 * available below it: 200-year and unsampled Method B remain post-MVP and fail
 * before a registry request can be materialized.
 */
export function buildDurabilityMeasurementSampleSubmissions(
  args: BuildDurabilityMeasurementSampleSubmissionsArgs,
): DurabilityMeasurementSampleSubmission[] {
  assertSupportedDurabilityConfiguration(args.batches);
  const thousandYearBatches = args.batches.filter(
    (batch) => batch.durabilityOption === "1000_year",
  );
  if (thousandYearBatches.length > 1) {
    throw new SafeError(
      "A 1000-year Removal can contain one credit batch. Split these credit batches into separate Removals.",
    );
  }

  const perBatch = buildPerBatchDurabilityData(
    args.batches,
    args.attributionByRunId,
  );
  const sourceBatchById = new Map(
    args.batches.map((batch) => [batch.creditBatchId, batch]),
  );
  const submissions: DurabilityMeasurementSampleSubmission[] = [];
  for (const batch of perBatch) {
    const sourceBatch = sourceBatchById.get(batch.creditBatchId);
    if (sourceBatch?.durabilityOption === "1000_year") {
      const replicateEvaluation = evaluateSampled1000YearReplicates({
        creditBatchCode: batch.creditBatchCode,
        samples: sourceBatch.samples,
      });
      if (replicateEvaluation.blockers.length > 0) {
        throw new SafeError(
          replicateEvaluation.blockers.join("\n"),
        );
      }
      const sampleById = new Map(
        sourceBatch.samples.map((sample) => [sample.id, sample]),
      );
      for (const replicate of replicateEvaluation.replicates) {
        const sampleLabel = replicate.sampleCode || replicate.sampleId;
        const sourceSample = sampleById.get(replicate.sampleId);
        if (!sourceSample) {
          throw new SafeError(
            `Sample ${sampleLabel} could not be loaded for production batch ${batch.creditBatchCode}. Refresh the Removal and try again.`,
          );
        }
        if (
          !(sourceSample.samplingTime instanceof Date) ||
          Number.isNaN(sourceSample.samplingTime.getTime())
        ) {
          throw new SafeError(
            `Sample ${sampleLabel} has no valid sampling time. Record the sampling event before submitting.`,
          );
        }
        if (sourceSample.samplingTime.getTime() > Date.now()) {
          throw new SafeError(
            `Sample ${sampleLabel} has a sampling time in the future. Correct the sampling event before submitting.`,
          );
        }
        const supplierRefId = buildMeasurementSampleReference({
          removalId: args.removalId,
          role: "production-batch",
          version: args.version,
          creditBatchId: batch.creditBatchId,
          sampleId: replicate.sampleId,
        });
        const body = build1000YearSequestrationSample({
          replicate,
          projectId: args.externalProjectId,
          supplierRefId,
          measuredAt: sourceSample.samplingTime.toISOString(),
        });
        submissions.push({
          creditBatchId: batch.creditBatchId,
          sampleId: replicate.sampleId,
          creditBatchProductMassKg: batch.productMassKg,
          operationKey: `pb:${batch.creditBatchId}:sample:${replicate.sampleId}`,
          supplierRefId,
          body,
          label: `Sample ${sampleLabel} in production batch ${batch.creditBatchCode}`,
        });
      }
      continue;
    }
  }

  return submissions;
}

export interface SubmitDurabilityMeasurementSamplesArgs {
  orgCtx: OrgContext;
  removalId: string;
  /** Claimed ledger row and its immutable snapshot/journal at attempt start. */
  submissionRow: {
    id: string;
    payloadSnapshot: unknown;
  };
  expectedLockedAt?: Date;
  deferRejectionToAttempt?: boolean;
  onExternalMutation?: RegistryExternalMutationReporter;
  /** From the claim outcome — a resumed draft reconciles before POSTing. */
  resumed: boolean;
  submissions: DurabilityMeasurementSampleSubmission[];
  sourceBindingPlan: RemovalSourceBindingPlanEntry[];
  log: Logger;
  onProgress?: (completed: number, total: number) => void;
}

export interface SubmitDurabilityMeasurementSamplesResult {
  submitted: number;
  samples: MeasurementSampleDatapointCapture[];
  datapointIdsByMeasurementProperty: Map<string, string[]>;
}

const PATCH_UNDEFINED = { __typename: "Undefined" } as const;

interface MeasurementSampleSourceBindingCapture
  extends MeasurementSampleDatapointCapture {
  creditBatchId: string | null;
  sampleId?: string;
  replicateSampleIds?: string[];
}

/**
 * Measurement-sample POSTs mint their Datapoints server-side, so the Inventory
 * Source can only be attached after reading the response. This patch must
 * complete before the GHG Entry is created.
 */
export async function patchMeasurementSampleSourceBindings(args: {
  client: IsometricClient;
  captures: MeasurementSampleSourceBindingCapture[];
  sourceBindingPlan: RemovalSourceBindingPlanEntry[];
}): Promise<number> {
  const propertyKeysByInput = new Map<string, string[]>([
    [
      "carbon_contents",
      [
        encodeMeasurementProperty(
          TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
        ),
      ],
    ],
    [
      "total_carbon_contents",
      [
        encodeMeasurementProperty(
          TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
        ),
        encodeMeasurementProperty(TOTAL_CARBON_MEASUREMENT_PROPERTY),
      ],
    ],
    [
      "inorganic_carbon_contents",
      [
        encodeMeasurementProperty(
          INORGANIC_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
        ),
        encodeMeasurementProperty(INORGANIC_CARBON_MEASUREMENT_PROPERTY),
      ],
    ],
    [
      "s_fraction",
      [encodeMeasurementProperty(S_FRACTION_MEASUREMENT_PROPERTY)],
    ],
    [
      "h_c_molar_ratios",
      [encodeMeasurementProperty(H_TO_C_ORG_MEASUREMENT_PROPERTY)],
    ],
  ]);
  let patchedCount = 0;
  for (const capture of args.captures) {
    if (!capture.creditBatchId) {
      throw new SafeError(
        `Registry measurement ${capture.measurementSampleId} is not linked to a credit batch. Ask support to check the registry mapping before submitting again.`,
      );
    }
    const creditBatchId = capture.creditBatchId;
    const batchBindings = args.sourceBindingPlan.filter(
      (entry) =>
        entry.intendedTarget.kind === "sequestration" &&
        entry.intendedTarget.creditBatchIds.includes(creditBatchId),
    );

    for (const [inputKey, propertyKeys] of propertyKeysByInput) {
      const datapointIds = propertyKeys.flatMap(
        (propertyKey) =>
          capture.datapointIdsByMeasurementProperty.get(propertyKey) ?? [],
      );
      if (datapointIds.length === 0) continue;
      const inputBindings = batchBindings.filter(
        (entry) => entry.intendedTarget.inputKey === inputKey,
      );

      for (const [index, datapointId] of datapointIds.entries()) {
        const replicateSampleId =
          capture.sampleId ?? capture.replicateSampleIds?.[index] ?? null;
        const sourceIds = Array.from(
          new Set(
            inputBindings
              .filter(
                (entry) =>
                  entry.lineage.entityType !== "sample" ||
                  entry.lineage.entityId === replicateSampleId,
              )
              .map((entry) => entry.sourceId),
          ),
        ).sort();
        if (sourceIds.length === 0) continue;
        const patched = await patchDatapoint(args.client, datapointId, {
          description: PATCH_UNDEFINED,
          display_name: PATCH_UNDEFINED,
          quantity: PATCH_UNDEFINED,
          source_ids: sourceIds,
          type: PATCH_UNDEFINED,
          uncertainty_justification: PATCH_UNDEFINED,
        });
        if (
          sourceIds.some((sourceId) => !patched.source_ids.includes(sourceId))
        ) {
          throw new SafeError(
            `Registry value ${datapointId} did not keep its Sources. Check the Sources in Isometric before submitting again.`,
          );
        }
        patchedCount += 1;
      }
    }
  }
  return patchedCount;
}

/** Credit batches whose samples need a registered production batch (#630). */
export function creditBatchIdsForMeasurementSamples(
  submissions: DurabilityMeasurementSampleSubmission[],
): string[] {
  return Array.from(
    new Set(submissions.map((submission) => submission.creditBatchId)),
  );
}

/**
 * Stamp each per-batch sample body with the Isometric production batch its
 * credit batch was registered as (#630).
 *
 * Applied to the SNAPSHOT bodies at POST time rather than baked in at claim
 * time on purpose: the `ptb_…` is minted by the registry during this very
 * submission, so it cannot exist when the immutable snapshot is materialized,
 * and folding it into the snapshot would make the semantic payload hash flip on
 * the first successful submission and retire every resumable draft. The wire
 * payload stays fully auditable — `performRegistryCreate` records the actual
 * request body on the sync event.
 *
 * Fails closed: a per-Sample request with no registered production batch would
 * silently submit `production_batch_id: null`, which is exactly the defect this
 * replaces. Every supported submission is linked to a credit batch.
 */
export function applyProductionBatchIds(
  submissions: DurabilityMeasurementSampleSubmission[],
  productionBatchIdByCreditBatchId: Map<string, string>,
): DurabilityMeasurementSampleSubmission[] {
  return submissions.map((submission) => {
    const creditBatchId = submission.creditBatchId;
    const productionBatchId =
      productionBatchIdByCreditBatchId.get(creditBatchId);
    if (!productionBatchId) {
      throw new SafeError(
        `The registry production batch for ${submission.label} is missing. Submit again once the registry record exists.`,
      );
    }
    return {
      ...submission,
      body: { ...submission.body, production_batch_id: productionBatchId },
    };
  });
}

/**
 * POST each measurement-sample submission through the shared create-or-reconcile
 * choreography (idempotent on the versioned supplier ref). Sequential so the
 * audit-event ordering is deterministic and a batch never bursts the connection
 * pool. Captures every returned value's required datapoint_id on both fresh
 * creates and supplier-reference reconciliation. Throws (via
 * `performRegistryCreate`) on an unrecoverable POST failure, which rejects the
 * claimed ledger row.
 */
export async function submitDurabilityMeasurementSamples(
  args: SubmitDurabilityMeasurementSamplesArgs,
): Promise<SubmitDurabilityMeasurementSamplesResult> {
  const client = await getIsometricClientForOrg(args.orgCtx.organizationId);
  let journaledSamples = readJournaledMeasurementSamples(
    args.submissionRow.payloadSnapshot,
  );
  let submitted = 0;
  const samples: MeasurementSampleDatapointCapture[] = [];
  const sourceBindingCaptures: MeasurementSampleSourceBindingCapture[] = [];
  for (const submission of args.submissions) {
    let resolvedSample: IsometricMeasurementSample | null = null;
    const journaled = journaledSamples.find(
      (entry) => entry.supplierReferenceId === submission.supplierRefId,
    );
    await performRegistryCreate({
      orgCtx: args.orgCtx,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: args.removalId,
      submissionRowId: args.submissionRow.id,
      expectedLockedAt: args.expectedLockedAt,
      deferRejectionToAttempt: args.deferRejectionToAttempt,
      operation: `measurement-sample:create:${submission.operationKey}`,
      requestPayload: submission.body,
      supplierRefId: submission.supplierRefId,
      resumed: args.resumed,
      create: async () => {
        const sample = await createMeasurementSample(client, submission.body);
        assertMeasurementSampleSupplierReference(
          sample,
          submission.supplierRefId,
        );
        resolvedSample = sample;
        return sample.id;
      },
      reconcile: async () => {
        const sample = await findMeasurementSampleBySupplierRef(
          client,
          submission.supplierRefId,
        );
        if (journaled && !sample) {
          return {
            found: "refused" as const,
            message: `Registry measurement ${journaled.measurementSampleId} cannot be found. Ask support to check the registry record before submitting again.`,
          };
        }
        if (journaled && sample?.id !== journaled.measurementSampleId) {
          return {
            found: "refused" as const,
            message: `Registry measurement ${journaled.measurementSampleId} does not match submission ${submission.supplierRefId}. Ask support to check the registry record.`,
          };
        }
        if (sample) {
          assertMeasurementSampleSupplierReference(
            sample,
            submission.supplierRefId,
          );
        }
        resolvedSample = sample;
        return supplierRefLookup(
          sample ? { found: true, externalId: sample.id } : { found: false },
        );
      },
      onConfirmed: async (externalId) => {
        if (!resolvedSample || resolvedSample.id !== externalId) {
          throw new SafeError(
            `Registry measurement for ${submission.label} could not be confirmed. Check it in Isometric before submitting again.`,
          );
        }
        const next = addJournaledMeasurementSample(journaledSamples, {
          supplierReferenceId: submission.supplierRefId,
          measurementSampleId: externalId,
        });
        if (!sameMeasurementSampleJournal(journaledSamples, next)) {
          await appendSubmissionJournal(
            args.orgCtx,
            args.submissionRow.id,
            { measurementSamples: next },
          );
          journaledSamples = next;
        }
      },
      failureMessagePrefix: `Registry measurement for ${submission.label} could not be created`,
      onExternalMutation: args.onExternalMutation,
      log: args.log,
    });
    if (!resolvedSample) {
      throw new SafeError(
        `The registry did not return values for ${submission.label}. Check the measurement in Isometric before submitting again.`,
      );
    }
    const capture = captureMeasurementSampleDatapointIds(
      resolvedSample,
      submission.body,
    );
    samples.push(capture);
    sourceBindingCaptures.push({
      ...capture,
      creditBatchId: submission.creditBatchId,
      sampleId: submission.sampleId,
    });
    submitted += 1;
    args.onProgress?.(submitted, args.submissions.length);
  }
  await patchMeasurementSampleSourceBindings({
    client,
    captures: sourceBindingCaptures,
    sourceBindingPlan: args.sourceBindingPlan,
  });
  return {
    submitted,
    samples,
    datapointIdsByMeasurementProperty:
      mergeMeasurementSampleDatapointIds(samples),
  };
}

function assertMeasurementSampleSupplierReference(
  sample: IsometricMeasurementSample,
  expected: string,
): void {
  if (sample.supplier_reference_id === expected) return;
  throw new SafeError(
    `Registry measurement ${sample.id} does not match submission ${expected}. Ask support to check the registry record.`,
  );
}

function sameMeasurementSampleJournal(
  left: JournaledMeasurementSample[],
  right: JournaledMeasurementSample[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.supplierReferenceId === right[index]?.supplierReferenceId &&
        entry.measurementSampleId === right[index]?.measurementSampleId,
    )
  );
}
