/**
 * Durability submission gates — the protocol's hard, fail-closed sampling and
 * eligibility blocks evaluated at removal-submission time (decision D3),
 * evaluated at the CREDIT-BATCH grain (ADR 0016: the credit batch IS the
 * protocol production batch; the sampling unit is the batch, never the run):
 *
 *   (a) Eligibility — the batch's POOLED replicate MEAN must satisfy
 *       H/C_org < 0.5 AND O/C_org < 0.2 (module §3 Table 2, judged per D8).
 *       Indeterminate chemistry (a missing ratio) fails closed.
 *   (b) Sampling presence — every batch created as sampled must carry ≥ 1
 *       sample (§8.3). A batch created as unsampled submits through the
 *       unsampled blueprint and is not judged on chemistry here.
 *   (c) Replicate sufficiency — any SAMPLED batch must pool ≥ 3 replicates
 *       (§8.3.1) across its member runs/days.
 *
 * Post-production sampling from stored material is permitted by §8.3.1 but is
 * not evidence of within-batch temporal distribution. Such samples remain
 * usable replicates while their day is excluded from the distribution check;
 * operators receive a warning to confirm spatial distribution with the
 * registry. A sample before the production window is physically impossible and
 * blocks submission.
 *
 * Pure and client-safe — the submission orchestrator (`submit-removal.ts`)
 * assembles the per-batch facts and throws a single SafeError on the blockers.
 * The COA / lab-report Source requirement (D4) lives with the measurement-sample
 * chemistry datapoints (Phase E), not here.
 */

import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  MINIMUM_REPLICATES_PER_BATCH,
  O_TO_C_ORG_ELIGIBILITY_MAX,
  evaluateReplicateCount,
  evaluateRunEligibility,
  isUsableNumber,
  type ReplicateRatios,
} from "@/lib/calculations/biochar-eligibility";
import type { CreditBatchSampling } from "@/schemas/credit-batches";

/** Provenance of one pooled replicate, for the distribution (cluster) check. */
export interface ReplicateProvenance {
  /** Human-facing sample identifier used in window diagnostics. */
  sampleCode: string;
  /** The production run the sample was physically drawn from (nullable post-0015). */
  productionRunId: string | null;
  /** ISO calendar day (YYYY-MM-DD) the sample was taken; null when unknown. */
  samplingDay: string | null;
}

export interface BatchGateFacts {
  creditBatchId: string;
  creditBatchCode: string;
  /** ISO date-only production window; null skips window checks fail-softly. */
  startDate?: string | null;
  endDate?: string | null;
  /** Immutable sampled/unsampled choice stored at batch creation. */
  sampling: CreditBatchSampling;
  /** Per-replicate stability ratios, pooled across the batch's member runs/days. */
  replicates: ReplicateRatios[];
  /** Parallel to `replicates` — each replicate's run/day, for the cluster warning. */
  replicateProvenance: ReplicateProvenance[];
}

export interface DurabilitySubmissionGateResult {
  ok: boolean;
  /** One human-readable blocker line per failed gate, ready to join into a SafeError. */
  blockers: string[];
  /** Non-blocking advisories — currently the §8.3.1 distribution (cluster) warning. */
  warnings: string[];
}

/**
 * A stored-material sample taken AFTER a batch's production window end remains a
 * valid replicate, but its later day cannot demonstrate within-batch temporal
 * distribution — so it is normalized to a null day for the §8.3.1 distribution
 * evidence. Days on/before endDate (or when endDate is unknown) pass through.
 */
export function normalizePostWindowSamplingDay(
  samplingDay: string | null,
  endDate: string | null | undefined,
): string | null {
  return endDate != null && samplingDay != null && samplingDay > endDate
    ? null
    : samplingDay;
}

/**
 * Distinct (run, day) provenance keys among a batch's pooled replicates — the
 * §8.3.1 "distributed across distinct runs/days" evidence. Replicates with
 * fully-null provenance can't be judged, so they add no key (a set of only
 * null-provenance replicates counts as 0 distinct). Shared with the readiness
 * surfaces (`durability-batch-summary.ts`) so the gate and the UI agree.
 */
export function countDistinctProvenance(
  provenance: ReplicateProvenance[],
): number {
  const runsWithKnownDays = new Set(
    provenance.flatMap((p) =>
      p.productionRunId != null && p.samplingDay != null
        ? [p.productionRunId]
        : [],
    ),
  );
  const keys = new Set(
    provenance
      .map((p) =>
        p.productionRunId == null && p.samplingDay == null
          ? null
          : p.productionRunId != null &&
              p.samplingDay == null &&
              runsWithKnownDays.has(p.productionRunId)
            ? null
          : `${p.productionRunId ?? "?"}::${p.samplingDay ?? "?"}`,
      )
      .filter((k): k is string => k != null),
  );
  return keys.size;
}

type ReplicateClusterReason = "single-run-day" | "unknown-provenance";

// A batch's pooled replicates "cluster" when they span only ONE distinct
// (run, day) provenance — the "aliquots of one grab" smell §8.3.1 warns against.
// Replicates with fully-null provenance can't be judged, so they don't count
// toward distinctness; if every replicate is fully null, warn on unknown
// provenance instead of saying they share one known run/day.
function getReplicateClusterReason(
  provenance: ReplicateProvenance[],
): ReplicateClusterReason | null {
  const distinct = countDistinctProvenance(provenance);
  if (distinct > 1) return null;
  return distinct === 0 ? "unknown-provenance" : "single-run-day";
}

// The distribution check must judge only the USABLE (complete-chemistry)
// replicates — the same set gate (c) counts via `usableReplicateCount`.
// `replicates` and `replicateProvenance` are parallel arrays (same index = same
// sample), so keep the provenance of indices whose chemistry is complete.
// Otherwise an incomplete sample on a different run/day adds a phantom distinct
// key and masks that the usable replicates all cluster on one run/day.
function usableProvenance(batch: BatchGateFacts): ReplicateProvenance[] {
  return batch.replicateProvenance
    .filter((_, i) => {
      const r = batch.replicates[i];
      return (
        r != null &&
        isUsableNumber(r.hToCOrgRatio) &&
        isUsableNumber(r.oToCOrgRatio)
      );
    })
    .map((provenance) => ({
      ...provenance,
      // Stored-material samples remain valid replicates, but their later day
      // cannot demonstrate temporal distribution within the production batch.
      samplingDay: normalizePostWindowSamplingDay(
        provenance.samplingDay,
        batch.endDate,
      ),
    }));
}

/**
 * Evaluate the D3 gates over a removal's credit batches. Returns every blocker
 * (so the operator sees all sampling/eligibility problems at once) plus any
 * non-blocking distribution warnings.
 */
export function evaluateDurabilitySubmissionGates(
  batches: BatchGateFacts[],
): DurabilitySubmissionGateResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const batch of batches) {
    const sampleRowCount = batch.replicates.length;

    if (batch.startDate != null && batch.endDate != null) {
      for (const sample of batch.replicateProvenance) {
        if (sample.samplingDay == null) continue;
        if (sample.samplingDay < batch.startDate) {
          blockers.push(
            `Sample ${sample.sampleCode} was taken on ${sample.samplingDay}, before credit batch ${batch.creditBatchCode}'s production window ${batch.startDate}–${batch.endDate}. The biochar did not yet exist; correct this data error before submission (§8.3.1).`,
          );
        } else if (sample.samplingDay > batch.endDate) {
          warnings.push(
            `Sample ${sample.sampleCode} was taken on ${sample.samplingDay}, after credit batch ${batch.creditBatchCode}'s production window ${batch.startDate}–${batch.endDate}. §8.3.1 permits sampling from stored material only when samples are spatially distributed across the stored batch; confirm this with the registry. This sampling day does not count as within-batch temporal distribution.`,
          );
        }
      }
    }

    // An unsampled choice is the regime boundary: incidental sample rows do not
    // reclassify the batch or route it through sampled chemistry gates.
    if (batch.sampling === "unsampled") continue;

    // (b) A batch explicitly created as sampled must carry sample evidence.
    if (sampleRowCount === 0) {
      blockers.push(
        `Credit batch ${batch.creditBatchCode} is marked sampled but has no samples (§8.3).`,
      );
      continue;
    }

    const eligibility = evaluateRunEligibility(batch.replicates);

    // (c) Replicate sufficiency — a sampled batch needs ≥ 3 COMPLETE-chemistry
    // replicates pooled across its member runs/days. A row without a usable
    // H/C_org + O/C_org pair doesn't characterise the batch, so count usable
    // replicates, not raw rows (§8.3.1).
    const replicateCheck = evaluateReplicateCount(
      eligibility.usableReplicateCount,
    );
    if (!replicateCheck.meetsMinimum) {
      blockers.push(
        `Credit batch ${batch.creditBatchCode} has ${eligibility.usableReplicateCount} replicate(s) with complete H/C_org + O/C_org chemistry; ≥ ${MINIMUM_REPLICATES_PER_BATCH} required per sampled batch (§8.3.1).`,
      );
    } else {
      // Judge distribution on the USABLE (complete-chemistry) subset so an
      // incomplete off-day sample can't mask a clustered usable set (§8.3.1).
      const clusterReason = getReplicateClusterReason(usableProvenance(batch));
      // ≥3 met but distribution is unproven or clustered — warn, don't block.
      if (clusterReason === "single-run-day") {
        warnings.push(
          `Credit batch ${batch.creditBatchCode}: all ${eligibility.usableReplicateCount} replicates cluster on a single run/day — §8.3.1 expects ≥3 independent samples distributed across distinct runs/days. Confirm this is a registry-agreed sampling alternative.`,
        );
      } else if (clusterReason === "unknown-provenance") {
        warnings.push(
          `Credit batch ${batch.creditBatchCode}: all ${eligibility.usableReplicateCount} replicates have unknown run/day provenance — §8.3.1 expects ≥3 independent samples distributed across distinct runs/days. Confirm this is a registry-agreed sampling alternative.`,
        );
      }
    }

    // (a) Eligibility — judged on the pooled replicate mean (D8); indeterminate fails closed.
    if (eligibility.eligible === false) {
      const parts: string[] = [];
      if (eligibility.hToCWithinThreshold === false) {
        parts.push(
          `H/C_org mean ${eligibility.meanHToCOrgRatio?.toFixed(3)} ≥ ${H_TO_C_ORG_ELIGIBILITY_MAX}`,
        );
      }
      if (eligibility.oToCWithinThreshold === false) {
        parts.push(
          `O/C_org mean ${eligibility.meanOToCOrgRatio?.toFixed(3)} ≥ ${O_TO_C_ORG_ELIGIBILITY_MAX}`,
        );
      }
      blockers.push(
        `Credit batch ${batch.creditBatchCode} fails biochar eligibility (${parts.join("; ")}) — module §3 Table 2.`,
      );
    } else if (eligibility.eligible === null) {
      blockers.push(
        `Credit batch ${batch.creditBatchCode} eligibility is indeterminate — missing H/C_org or O/C_org chemistry; cannot confirm it meets module §3 Table 2.`,
      );
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}
