/**
 * 200-year durability measurement-samples submission step (Tier-1 Phase 3).
 *
 * Server-internal core (no "use server" — it takes an explicit `userId` and runs
 * inside the submit pipeline, which already resolved the caller). For each member
 * credit batch it POSTs one `biochar_production_batch` measurement sample (H/C +
 * total/inorganic carbon + product mass, each value a per-batch mean ± std-dev),
 * plus one `biochar_soil` sample carrying the facility reference soil temperature.
 * Each measurement-sample value yields a datapoint the registry binds to the
 * matching `biochar_sequestration_200_year_c_org` list input.
 *
 * ─── ⚠️ STAGED, NOT LIVE — gated on `DURABILITY_MEASUREMENT_SAMPLES_LIVE` ──────
 * The two sandbox-empirical confirms (datapoint↔component-input binding; the H/C
 * + carbon + mass unit scalings — see `transformers/measurement-sample.ts` and
 * `docs/open-questions.md` `isometric/durability-measurement-samples`) are not
 * resolved, so the live POST stays behind this flag. While it is `false`,
 * `submitRemoval` hard-blocks any template that declares a sequestration
 * component, so this step never runs against the registry. Flip the flag (and
 * tune the one-constant unit/property guesses in the transformer) only after the
 * operator's `pnpm isometric:coverage-check -- --source=db` confirms both.
 *
 * The POST choreography reuses `performRegistryCreate` (create → on failure
 * reconcile by supplier-ref lookup → audit event / ledger-reject), idempotent on
 * the versioned supplier reference, mirroring the datapoint/removal/sensor flows.
 */
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { Logger } from "@/lib/log";
import {
  buildMeasurementSampleReference,
  createMeasurementSample,
  findMeasurementSampleBySupplierRef,
  type CreateMeasurementSampleRequest,
} from "@/lib/isometric/measurement-samples";
import {
  buildBiocharProductionBatchSample,
  buildBiocharSoilSample,
} from "@/lib/isometric/transformers/measurement-sample";
import {
  buildPerBatchDurabilityData,
  type FacilityReferenceSoilTemperature,
} from "@/lib/isometric/utils/durability-aggregation";
import { performRegistryCreate, supplierRefLookup } from "./registry-create";
import { REMOVAL_ENTITY_TYPE } from "./shared";

/**
 * Master gate for the live 200-year durability measurement-samples POST. Stays
 * `false` until the operator confirms the two sandbox-empirical questions (the
 * datapoint↔component-input binding and the H/C + carbon + mass unit scalings).
 * `submitRemoval` blocks any sequestration-template submission while it is off,
 * so no half-confirmed payload can reach a live credit.
 */
export const DURABILITY_MEASUREMENT_SAMPLES_LIVE = false;

/** One measurement-sample POST: its versioned supplier ref + the request body. */
export interface DurabilityMeasurementSampleSubmission {
  /** Sync-event operation suffix, e.g. `pb:<creditBatchId>` or `soil`. */
  operationKey: string;
  supplierRefId: string;
  body: CreateMeasurementSampleRequest;
  /** Human label for logs / failure messages. */
  label: string;
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
  /** Facility reference soil temperature (7 °C-floored; non-null past the gate). */
  facilityReferenceSoilTemperature: FacilityReferenceSoilTemperature;
  /** ISO date-time the chemistry is reported for (the removal window end). */
  measuredAt: string;
}

/**
 * Build the ordered measurement-sample submissions for a removal: one
 * `biochar_production_batch` per sampled credit batch, then the single
 * `biochar_soil` facility-reference sample. Pure — no I/O. An unsampled batch
 * (Method B only; never under Method A) yields no production-batch body and is
 * skipped — it carries no chemistry to group.
 */
export function buildDurabilityMeasurementSampleSubmissions(
  args: BuildDurabilityMeasurementSampleSubmissionsArgs,
): DurabilityMeasurementSampleSubmission[] {
  const perBatch = buildPerBatchDurabilityData(
    args.batches,
    args.attributionByRunId,
  );

  const submissions: DurabilityMeasurementSampleSubmission[] = [];
  for (const batch of perBatch) {
    const supplierRefId = buildMeasurementSampleReference({
      removalId: args.removalId,
      role: "production-batch",
      version: args.version,
      creditBatchId: batch.creditBatchId,
    });
    const body = buildBiocharProductionBatchSample({
      batch,
      projectId: args.externalProjectId,
      supplierRefId,
      measuredAt: args.measuredAt,
    });
    if (!body) continue;
    submissions.push({
      operationKey: `pb:${batch.creditBatchId}`,
      supplierRefId,
      body,
      label: `production batch ${batch.creditBatchCode}`,
    });
  }

  const soilSupplierRefId = buildMeasurementSampleReference({
    removalId: args.removalId,
    role: "soil",
    version: args.version,
  });
  submissions.push({
    operationKey: "soil",
    supplierRefId: soilSupplierRefId,
    body: buildBiocharSoilSample({
      soilTemp: args.facilityReferenceSoilTemperature,
      projectId: args.externalProjectId,
      supplierRefId: soilSupplierRefId,
      measuredAt: args.measuredAt,
    }),
    label: "facility soil reference",
  });

  return submissions;
}

export interface SubmitDurabilityMeasurementSamplesArgs {
  userId: string;
  removalId: string;
  /** Ledger row claimed for this attempt — rejected on unrecoverable failure. */
  submissionRowId: string;
  /** From the claim outcome — a resumed draft reconciles before POSTing. */
  resumed: boolean;
  submissions: DurabilityMeasurementSampleSubmission[];
  log: Logger;
}

/**
 * POST each measurement-sample submission through the shared create-or-reconcile
 * choreography (idempotent on the versioned supplier ref). Sequential so the
 * audit-event ordering is deterministic and a batch never bursts the connection
 * pool. Returns the count actually submitted. Throws (via `performRegistryCreate`)
 * on an unrecoverable POST failure, which rejects the claimed ledger row.
 */
export async function submitDurabilityMeasurementSamples(
  args: SubmitDurabilityMeasurementSamplesArgs,
): Promise<{ submitted: number }> {
  let submitted = 0;
  for (const submission of args.submissions) {
    await performRegistryCreate({
      userId: args.userId,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: args.removalId,
      submissionRowId: args.submissionRowId,
      operation: `measurement-sample:create:${submission.operationKey}`,
      requestPayload: submission.body,
      supplierRefId: submission.supplierRefId,
      resumed: args.resumed,
      create: () => createMeasurementSample(submission.body).then((m) => m.id),
      reconcile: () =>
        findMeasurementSampleBySupplierRef(submission.supplierRefId).then((m) =>
          supplierRefLookup(
            m ? { found: true, externalId: m.id } : { found: false },
          ),
        ),
      failureMessagePrefix: `Measurement sample POST failed for ${submission.label}`,
      log: args.log,
    });
    submitted += 1;
  }
  return { submitted };
}
