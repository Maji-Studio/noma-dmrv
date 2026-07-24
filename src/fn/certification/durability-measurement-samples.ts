/**
 * 200-year durability measurement-samples submission step (Tier-1 Phase 3).
 *
 * Server-internal core (no "use server" — it takes an explicit `orgCtx` and runs
 * inside the submit pipeline, which already resolved the caller). For each member
 * credit batch it POSTs one `biochar_production_batch` measurement sample (H/C +
 * total/inorganic carbon + product mass, each value a per-batch mean ± std-dev),
 * plus one `biochar_soil` sample carrying the facility reference soil temperature.
 * Measurement-sample response datapoints bind inputs declared with the
 * `measurement-property` source. Values retained only as evidence (currently
 * 1000-year `s_fraction`) are bound through direct orchestrator datapoints.
 *
 * ─── ⚠️ STAGED, NOT LIVE — gated on `DURABILITY_MEASUREMENT_SAMPLES_LIVE` ──────
 * Explicit binding is implemented for the verified 1000-year component. The
 * 200-year H/C unit scaling and property/input table remain unverified (see
 * `docs/open-questions.md`), so the registry POST stays behind this flag. While
 * it is `false`,
 * `submitRemoval` hard-blocks any template that declares a sequestration
 * component, so this step never runs against the registry. The operator enables
 * the flag only for the sandbox after validating the active durability path.
 *
 * The POST choreography reuses `performRegistryCreate` (create → on failure
 * reconcile by supplier-ref lookup → audit event / ledger-reject), idempotent on
 * the versioned supplier reference, mirroring the datapoint/removal/sensor flows.
 */
import type { OrgContext } from "@/lib/auth/server";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import { env } from "@/config/env";
import type { Logger } from "@/lib/log";
import { getIsometricClientForOrg } from "@/lib/isometric/client";
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
  buildBiocharProductionBatchSample,
  buildBiocharSoilSample,
  buildBiocharUnsampledBatchSample,
  build1000YearSequestrationSample,
  selectSequestrationBlueprintKey,
  SEQUESTRATION_BLUEPRINT_SAMPLED,
} from "@/lib/isometric/transformers/measurement-sample";
import { MINIMUM_REPLICATES_PER_BATCH } from "@/lib/calculations/biochar-eligibility";
import { SafeError } from "@/lib/errors";
import {
  buildPerBatchDurabilityData,
  type FacilityReferenceSoilTemperature,
} from "@/lib/isometric/utils/durability-aggregation";
import { performRegistryCreate, supplierRefLookup } from "./registry-create";
import { REMOVAL_ENTITY_TYPE } from "./shared";

/**
 * Sandbox-only gate for durability measurement-sample POSTs. The 1000-year
 * explicit binding is implemented, while the 200-year table still awaits its
 * H/C unit confirm. `submitRemoval` blocks every sequestration-template
 * submission while this is off, so it can never create an emissions-only entry.
 */
export const DURABILITY_MEASUREMENT_SAMPLES_LIVE =
  env.ISOMETRIC_ENVIRONMENT === "sandbox" &&
  env.DURABILITY_MEASUREMENT_SAMPLES_LIVE;

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
  /** Facility reference soil temperature; required only for 200-year batches. */
  facilityReferenceSoilTemperature: FacilityReferenceSoilTemperature | null;
  /** ISO date-time the chemistry is reported for (the removal window end). */
  measuredAt: string;
}

/**
 * Build the ordered measurement-sample submissions for a removal: one
 * `biochar_production_batch` per credit batch, then the single `biochar_soil`
 * facility-reference sample. Pure — no I/O.
 *
 * A SAMPLED batch routes to the `_c_org` blueprint carrying its pooled chemistry
 * + mass. An UNSAMPLED batch (validated against computed Method-B eligibility
 * when it is created) routes to the
 * `_unsampled` blueprint carrying mass only — the registry derives its carbon +
 * durable fraction from the process's sampled history (D8). The whole step stays behind
 * `DURABILITY_MEASUREMENT_SAMPLES_LIVE`; the `_unsampled` wire format is a sandbox
 * confirm (see `buildBiocharUnsampledBatchSample`).
 */
export function buildDurabilityMeasurementSampleSubmissions(
  args: BuildDurabilityMeasurementSampleSubmissionsArgs,
): DurabilityMeasurementSampleSubmission[] {
  const perBatch = buildPerBatchDurabilityData(
    args.batches,
    args.attributionByRunId,
  );
  const sourceBatchById = new Map(
    args.batches.map((batch) => [batch.creditBatchId, batch]),
  );
  const samplingByBatch = new Map(
    args.batches.map((batch) => [batch.creditBatchId, batch.sampling]),
  );

  const submissions: DurabilityMeasurementSampleSubmission[] = [];
  for (const batch of perBatch) {
    const supplierRefId = buildMeasurementSampleReference({
      removalId: args.removalId,
      role: "production-batch",
      version: args.version,
      creditBatchId: batch.creditBatchId,
    });

    const sourceBatch = sourceBatchById.get(batch.creditBatchId);
    const sampling = samplingByBatch.get(batch.creditBatchId) ?? "sampled";
    if (sampling === "unsampled") {
      submissions.push({
        operationKey: `pb-unsampled:${batch.creditBatchId}`,
        supplierRefId,
        body: buildBiocharUnsampledBatchSample({
          batch,
          projectId: args.externalProjectId,
          supplierRefId,
          measuredAt: args.measuredAt,
        }),
        label: `unsampled production batch ${batch.creditBatchCode}`,
      });
      continue;
    }
    if (sourceBatch?.durabilityOption === "1000_year") {
      // Replicate order flows verbatim into the submission body's `values`
      // list and therefore into the semantic change-detection hash
      // (`normalizeMeasurementSamplesForHash` only sorts across submissions,
      // not within one body). Sort by sample id so this builder is a
      // deterministic function of its inputs regardless of how the caller's
      // DB read happened to order the rows.
      const orderedSamples = [...sourceBatch.samples].sort((a, b) =>
        String(a.id).localeCompare(String(b.id)),
      );
      const replicates = orderedSamples.flatMap((sample) =>
        sample.totalCarbonPercent == null || sample.sReflectanceFraction == null
          ? []
          : [
              {
                carbonContentFraction: sample.totalCarbonPercent / 100,
                sFraction: sample.sReflectanceFraction,
              },
            ],
      );
      const incompleteReplicates = sourceBatch.samples.length - replicates.length;
      if (incompleteReplicates > 0) {
        throw new SafeError(
          `Credit batch ${batch.creditBatchCode} has ${incompleteReplicates} sample(s) missing total carbon or the R₀ readings-at-or-above-2% fraction required for 1000-year submission.`,
        );
      }
      if (replicates.length < MINIMUM_REPLICATES_PER_BATCH) {
        throw new SafeError(
          `Credit batch ${batch.creditBatchCode} has ${replicates.length} complete 1000-year replicate(s); ≥ ${MINIMUM_REPLICATES_PER_BATCH} required.`,
        );
      }
      const body = build1000YearSequestrationSample({
        replicates,
        productMassKg: batch.productMassKg,
        projectId: args.externalProjectId,
        supplierRefId,
        measuredAt: args.measuredAt,
      });
      if (body) {
        submissions.push({
          operationKey: `pb:${batch.creditBatchId}`,
          supplierRefId,
          body,
          label: `production batch ${batch.creditBatchCode}`,
        });
      }
      continue;
    }

    // The blueprint is the registry-facing sampled/unsampled distinction (D6);
    // dispatch from the immutable stored batch choice.
    const blueprintKey = selectSequestrationBlueprintKey({
      sampling,
    });

    if (blueprintKey === SEQUESTRATION_BLUEPRINT_SAMPLED) {
      const body = buildBiocharProductionBatchSample({
        batch,
        projectId: args.externalProjectId,
        supplierRefId,
        measuredAt: args.measuredAt,
      });
      // Defensive: a sampled batch without a usable H/C anchor yields no body.
      if (!body) continue;
      submissions.push({
        operationKey: `pb:${batch.creditBatchId}`,
        supplierRefId,
        body,
        label: `production batch ${batch.creditBatchCode}`,
      });
    }
  }

  if (args.batches.some((batch) => batch.durabilityOption === "200_year")) {
    if (!args.facilityReferenceSoilTemperature) {
      throw new Error(
        "A facility reference soil temperature is required for 200-year durability samples.",
      );
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
  }

  return submissions;
}

export interface SubmitDurabilityMeasurementSamplesArgs {
  orgCtx: OrgContext;
  removalId: string;
  /** Ledger row claimed for this attempt — rejected on unrecoverable failure. */
  submissionRowId: string;
  /** From the claim outcome — a resumed draft reconciles before POSTing. */
  resumed: boolean;
  submissions: DurabilityMeasurementSampleSubmission[];
  log: Logger;
}

export interface SubmitDurabilityMeasurementSamplesResult {
  submitted: number;
  samples: MeasurementSampleDatapointCapture[];
  datapointIdsByMeasurementProperty: Map<string, string[]>;
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
  let submitted = 0;
  const samples: MeasurementSampleDatapointCapture[] = [];
  for (const submission of args.submissions) {
    let resolvedSample: IsometricMeasurementSample | null = null;
    await performRegistryCreate({
      orgCtx: args.orgCtx,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: args.removalId,
      submissionRowId: args.submissionRowId,
      operation: `measurement-sample:create:${submission.operationKey}`,
      requestPayload: submission.body,
      supplierRefId: submission.supplierRefId,
      resumed: args.resumed,
      create: async () => {
        const sample = await createMeasurementSample(client, submission.body);
        resolvedSample = sample;
        return sample.id;
      },
      reconcile: async () => {
        const sample = await findMeasurementSampleBySupplierRef(
          client,
          submission.supplierRefId,
        );
        resolvedSample = sample;
        return supplierRefLookup(
          sample ? { found: true, externalId: sample.id } : { found: false },
        );
      },
      failureMessagePrefix: `Measurement sample POST failed for ${submission.label}`,
      log: args.log,
    });
    if (!resolvedSample) {
      throw new SafeError(
        `Measurement sample ${submission.supplierRefId} was created or reconciled without a response body; its sequestration datapoint IDs cannot be captured.`,
      );
    }
    samples.push(captureMeasurementSampleDatapointIds(resolvedSample));
    submitted += 1;
  }
  return {
    submitted,
    samples,
    datapointIdsByMeasurementProperty:
      mergeMeasurementSampleDatapointIds(samples),
  };
}
