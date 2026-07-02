/**
 * Durability batch summary — the per-credit-batch sample roll-up + readiness view
 * model behind the two Phase-5 UX surfaces (the lab-sample create form's progress
 * preview and the credit-batch detail's durability section).
 *
 * Pure and client-safe (no server-only imports), so the form, the detail page,
 * and the submit pipeline all read the SAME figures. It reuses, not re-derives:
 *   - `buildPerBatchDurabilityData` → the submitted mean ± std-dev (the exact
 *     values the measurement-sample POST sends) + replicate count + product mass.
 *   - `evaluateRunEligibility` → the protocol §3 Table 2 verdict (H/C_org < 0.5
 *     AND O/C_org < 0.2 on the pooled paired mean) + per-replicate outlier flags.
 *   - `evaluateReplicateCount` → the §8.3.1 ≥3 gate (on usable paired replicates,
 *     mirroring the submission gate — incomplete-chemistry rows don't count).
 *   - `countDistinctProvenance` → the §8.3.1 distribution (distinct run/day)
 *     evidence; the cluster warning fires exactly as the submission gate's does.
 *
 * Unlike `durability-build-model.ts` (which builds the evidence-ledger PDF and so
 * drops unsampled / sub-3 batches), this summary describes a batch at ANY stage —
 * 0 samples, 1, or ≥3 — because the surfaces show progress TOWARD readiness, not
 * just the final ledger. Figures are noma's native units (dimensionless H/C,
 * carbon %, kg); the registry wire-unit transforms are a separate concern.
 *
 * Non-authoritative protocol summary — verify against the pinned module URL
 * before relying on it for credit claims.
 */

import type { Sample } from "@/db/schema";
import { formatUtcDate } from "@/lib/date-utils";
import {
  evaluateReplicateCount,
  evaluateRunEligibility,
  isUsableNumber,
  MINIMUM_REPLICATES_PER_BATCH,
} from "@/lib/calculations/biochar-eligibility";
import {
  buildPerBatchDurabilityData,
  type CreditBatchDurabilityInput,
  type ValueWithStdDev,
} from "@/lib/isometric/utils/durability-aggregation";
import { countDistinctProvenance } from "./durability-submission-gates";
import type { SamplingMethod } from "./sampling-requirements";

// ISO calendar day (YYYY-MM-DD) of a sampling timestamp. Typed `unknown` because
// the column maps to `Date` but raw rows / fixtures can carry a string. Mirrors
// the gate's `isoSamplingDay`, so the distribution check agrees with submission.
function samplingDayOf(samplingTime: unknown): string | null {
  if (samplingTime instanceof Date) return formatUtcDate(samplingTime) || null;
  if (typeof samplingTime === "string" && samplingTime.length >= 10) {
    return samplingTime.slice(0, 10);
  }
  return null;
}

/**
 * One credit batch with its pooled lab Samples and member runs (carrying run
 * codes for the per-replicate provenance display). A structural superset of
 * `CreditBatchDurabilityInput` — `getCreditBatchesWithSamples` returns a
 * compatible shape, so the DB loader feeds this directly without a server import.
 */
export interface DurabilityBatchSummaryInput extends CreditBatchDurabilityInput {
  /** The batch's process's CURRENT sampling method (default Method A). */
  samplingMethod: SamplingMethod;
  /** Member runs (id + code + dry mass) — code labels the replicate provenance. */
  runs: Array<{ id: string; code: string; biocharDryMassKg: number | null }>;
  /**
   * The batch's declared durability tier. A Sample characterises its credit
   * batch, so the tier lives on the batch and the lab-sample form DERIVES it
   * (issue #309) — optional here only so fixture inputs stay light; the DB
   * loader always supplies it.
   */
  durabilityOption?: "200_year" | "1000_year";
}

/** One raw lab replicate row, shaped for the roll-up table. */
export interface DurabilitySummaryReplicate {
  id: string;
  sampleCode: string;
  /** The run the replicate was drawn from (nullable provenance post-0015). */
  productionRunId: string | null;
  /** That run's code, resolved from the batch's member runs; null when unknown. */
  productionRunCode: string | null;
  /** ISO calendar day (YYYY-MM-DD) the sample was drawn; null when unknown. */
  samplingDay: string | null;
  labName: string | null;
  hToCorg: number | null;
  oToCorg: number | null;
  totalCarbonPercent: number | null;
  organicCarbonPercent: number | null;
  /** True when this replicate individually breaches an eligibility ceiling (D8). */
  outlier: boolean;
}

/** The protocol §3 Table 2 permanence verdict (judged on the pooled paired mean). */
export interface DurabilitySummaryEligibility {
  /** true / false once both means resolve; null when indeterminate (fails closed). */
  eligible: boolean | null;
  hToCorgMean: number | null;
  oToCorgMean: number | null;
  /** mean < 0.5; null when the H/C_org mean is indeterminate. */
  hToCWithinThreshold: boolean | null;
  /** mean < 0.2; null when the O/C_org mean is indeterminate. */
  oToCWithinThreshold: boolean | null;
}

/** The mean ± std-dev the measurement-sample POST submits for this batch. */
export interface DurabilitySummarySubmitted {
  hToCorg: ValueWithStdDev | null;
  totalCarbonPercent: ValueWithStdDev | null;
  inorganicCarbonPercent: ValueWithStdDev | null;
  /** Attribution-scaled biochar dry mass (kg) summed across member runs. */
  productMassKg: number;
}

export interface DurabilityBatchSummary {
  creditBatchId: string;
  creditBatchCode: string;
  samplingMethod: SamplingMethod;
  /** The batch's declared durability tier — samples inherit it (issue #309). */
  durabilityOption: "200_year" | "1000_year";
  /** Raw lab sample rows pooled on this batch (across member runs/days). */
  sampleCount: number;
  /** Replicates carrying paired H/C_org + O/C_org — the eligibility / ≥3-count set. */
  usableReplicateCount: number;
  /** Protocol minimum replicates per sampled batch (§8.3.1). */
  minimumReplicates: number;
  /** usableReplicateCount ≥ minimumReplicates. */
  meetsMinimum: boolean;
  /** Distinct (run, day) provenance keys among the samples (§8.3.1 distribution). */
  distinctRunDayCount: number;
  /** ≥3 met but all replicates cluster on a single run/day (§8.3.1 advisory). */
  distributionWarning: boolean;
  eligibility: DurabilitySummaryEligibility;
  submitted: DurabilitySummarySubmitted;
  /** Per-replicate display rows (raw lab chemistry), in pooled order. */
  replicates: DurabilitySummaryReplicate[];
}

/**
 * Build the per-batch durability summaries for a set of credit batches. One entry
 * per input batch (including unsampled ones — the surfaces show progress toward
 * ≥3). `attributionByRunId` scales each member run's product mass by its applied
 * share, mirroring `buildPerBatchDurabilityData`; omit it (or leave a run out) to
 * count a run fully — the detail/form surfaces show the full-batch mass.
 */
export function buildDurabilityBatchSummaries(
  batches: DurabilityBatchSummaryInput[],
  attributionByRunId?: Map<string, number>,
): DurabilityBatchSummary[] {
  const perBatch = buildPerBatchDurabilityData(batches, attributionByRunId);
  const perBatchById = new Map(perBatch.map((dp) => [dp.creditBatchId, dp]));

  return batches.map((batch) => {
    const dp = perBatchById.get(batch.creditBatchId);
    const runCodeById = new Map(batch.runs.map((r) => [r.id, r.code]));

    const eligibility = evaluateRunEligibility(
      batch.samples.map((s) => ({
        hToCOrgRatio: s.hToCOrgRatio,
        oToCOrgRatio: s.oToCOrgRatio,
      })),
    );
    const outlierIndexes = new Set(eligibility.outlierReplicateIndexes);

    // The distribution count must judge only the USABLE (complete paired-
    // chemistry) replicates — the same set the ≥3 gate counts — so this readiness
    // surface can never disagree with the submission gate's cluster check
    // (mirrors `usableProvenance` in durability-submission-gates.ts). An
    // incomplete sample on a different run/day must not add a phantom distinct
    // key that masks a clustered usable set.
    const provenance = batch.samples
      .filter(
        (s) =>
          isUsableNumber(s.hToCOrgRatio) && isUsableNumber(s.oToCOrgRatio),
      )
      .map((s) => ({
        productionRunId: s.productionRunId,
        samplingDay: samplingDayOf(s.samplingTime),
      }));
    const distinctRunDayCount = countDistinctProvenance(provenance);
    const replicateCheck = evaluateReplicateCount(
      eligibility.usableReplicateCount,
    );

    const replicates: DurabilitySummaryReplicate[] = batch.samples.map(
      (s, index) => buildReplicate(s, index, runCodeById, outlierIndexes),
    );

    return {
      creditBatchId: batch.creditBatchId,
      creditBatchCode: batch.creditBatchCode,
      samplingMethod: batch.samplingMethod,
      durabilityOption: batch.durabilityOption ?? "200_year",
      sampleCount: batch.samples.length,
      usableReplicateCount: eligibility.usableReplicateCount,
      minimumReplicates: MINIMUM_REPLICATES_PER_BATCH,
      meetsMinimum: replicateCheck.meetsMinimum,
      distinctRunDayCount,
      // A clustered set (≤1 distinct run/day) only matters once ≥3 are met —
      // below the minimum the ≥3 gap is the headline, not the distribution.
      distributionWarning: replicateCheck.meetsMinimum && distinctRunDayCount <= 1,
      eligibility: {
        eligible: eligibility.eligible,
        hToCorgMean: eligibility.meanHToCOrgRatio,
        oToCorgMean: eligibility.meanOToCOrgRatio,
        hToCWithinThreshold: eligibility.hToCWithinThreshold,
        oToCWithinThreshold: eligibility.oToCWithinThreshold,
      },
      submitted: {
        hToCorg: dp?.hToCorgRatio ?? null,
        totalCarbonPercent: dp?.totalCarbonPercent ?? null,
        inorganicCarbonPercent: dp?.inorganicCarbonPercent ?? null,
        productMassKg: dp?.productMassKg ?? 0,
      },
      replicates,
    };
  });
}

function buildReplicate(
  s: Sample,
  index: number,
  runCodeById: Map<string, string>,
  outlierIndexes: Set<number>,
): DurabilitySummaryReplicate {
  return {
    id: s.id,
    sampleCode: s.sampleCode,
    productionRunId: s.productionRunId,
    productionRunCode:
      s.productionRunId != null
        ? runCodeById.get(s.productionRunId) ?? null
        : null,
    samplingDay: samplingDayOf(s.samplingTime),
    labName: s.labName ?? null,
    hToCorg: isUsableNumber(s.hToCOrgRatio) ? s.hToCOrgRatio : null,
    oToCorg: isUsableNumber(s.oToCOrgRatio) ? s.oToCOrgRatio : null,
    totalCarbonPercent: isUsableNumber(s.totalCarbonPercent)
      ? s.totalCarbonPercent
      : null,
    organicCarbonPercent: isUsableNumber(s.organicCarbonPercent)
      ? s.organicCarbonPercent
      : null,
    outlier: outlierIndexes.has(index),
  };
}
