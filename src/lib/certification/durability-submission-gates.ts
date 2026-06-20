/**
 * Durability submission gates — the protocol's hard, fail-closed sampling and
 * eligibility blocks evaluated at removal-submission time (decision D3),
 * evaluated at the CREDIT-BATCH grain (ADR 0016: the credit batch IS the
 * protocol production batch; the sampling unit is the batch, never the run):
 *
 *   (a) Eligibility — the batch's POOLED replicate MEAN must satisfy
 *       H/C_org < 0.5 AND O/C_org < 0.2 (module §3 Table 2, judged per D8).
 *       Indeterminate chemistry (a missing ratio) fails closed.
 *   (b) Sampling presence — every Method A batch must carry ≥ 1 sample (§8.3). A
 *       Method B batch MAY be unsampled (it submits via the unsampled blueprint),
 *       so it is not blocked here.
 *   (c) Replicate sufficiency — any SAMPLED batch must pool ≥ 3 replicates
 *       (§8.3.1) across its member runs/days.
 *
 * Plus one non-blocking WARNING: ≥3 replicates that all cluster on a single
 * run/day are not the "≥3 independent samples distributed across distinct
 * runs/days" §8.3.1 calls for. The code can't decide whether a clustered set is
 * a registry-agreed alternative, so it warns rather than blocks.
 *
 * Pure and client-safe — the submission orchestrator (`submit-removal.ts`)
 * assembles the per-batch facts and throws a single SafeError on the blockers.
 * The COA / lab-report Source requirement (D4) lives with the measurement-sample
 * chemistry datapoints (Phase E), not here.
 */

import { METHOD_B_SAMPLING_CADENCE_RUNS } from "@/config/certification";
import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  MINIMUM_REPLICATES_PER_RUN,
  O_TO_C_ORG_ELIGIBILITY_MAX,
  evaluateReplicateCount,
  evaluateRunEligibility,
  isUsableNumber,
  type ReplicateRatios,
} from "@/lib/calculations/biochar-eligibility";
import {
  deriveSamplingRequirement,
  type SamplingMethod,
} from "./sampling-requirements";

/** Provenance of one pooled replicate, for the distribution (cluster) check. */
export interface ReplicateProvenance {
  /** The production run the sample was physically drawn from (nullable post-0015). */
  productionRunId: string | null;
  /** ISO calendar day (YYYY-MM-DD) the sample was taken; null when unknown. */
  samplingDay: string | null;
}

export interface BatchGateFacts {
  creditBatchId: string;
  creditBatchCode: string;
  /**
   * The (facility, feedstock) production process this batch belongs to — runs
   * grouped by it for the Method B cadence check (d). Null falls back to the
   * batch id (its own singleton group).
   */
  productionProcessId: string | null;
  /** The batch's process's CURRENT sampling method (D6 — derived, never stored). */
  samplingMethod: SamplingMethod;
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
 * Distinct (run, day) provenance keys among a batch's pooled replicates — the
 * §8.3.1 "distributed across distinct runs/days" evidence. Replicates with
 * fully-null provenance can't be judged, so they add no key (a set of only
 * null-provenance replicates counts as 0 distinct). Shared with the readiness
 * surfaces (`durability-batch-summary.ts`) so the gate and the UI agree.
 */
export function countDistinctProvenance(
  provenance: ReplicateProvenance[],
): number {
  const keys = new Set(
    provenance
      .map((p) =>
        p.productionRunId == null && p.samplingDay == null
          ? null
          : `${p.productionRunId ?? "?"}::${p.samplingDay ?? "?"}`,
      )
      .filter((k): k is string => k != null),
  );
  return keys.size;
}

// A batch's pooled replicates "cluster" when they span only ONE distinct
// (run, day) provenance — the "aliquots of one grab" smell §8.3.1 warns against.
// Replicates with fully-null provenance can't be judged, so they don't count
// toward distinctness (a single null-provenance set reads as clustered).
function replicatesCluster(provenance: ReplicateProvenance[]): boolean {
  return countDistinctProvenance(provenance) <= 1;
}

// The distribution check must judge only the USABLE (complete-chemistry)
// replicates — the same set gate (c) counts via `usableReplicateCount`.
// `replicates` and `replicateProvenance` are parallel arrays (same index = same
// sample), so keep the provenance of indices whose chemistry is complete.
// Otherwise an incomplete sample on a different run/day adds a phantom distinct
// key and masks that the usable replicates all cluster on one run/day.
function usableProvenance(batch: BatchGateFacts): ReplicateProvenance[] {
  return batch.replicateProvenance.filter((_, i) => {
    const r = batch.replicates[i];
    return (
      r != null && isUsableNumber(r.hToCOrgRatio) && isUsableNumber(r.oToCOrgRatio)
    );
  });
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

    // (b) Method A presence — every Method A batch must be sampled.
    if (sampleRowCount === 0) {
      if (batch.samplingMethod === "method_a") {
        blockers.push(
          `Credit batch ${batch.creditBatchCode} (Method A) has no samples — every Method A batch must be sampled before submission (§8.3).`,
        );
      }
      // Method B unsampled batch is valid (submits via the unsampled blueprint);
      // its cadence is enforced across the process's batch set in (d) below.
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
        `Credit batch ${batch.creditBatchCode} has ${eligibility.usableReplicateCount} replicate(s) with complete H/C_org + O/C_org chemistry; ≥ ${MINIMUM_REPLICATES_PER_RUN} required per sampled batch (§8.3.1).`,
      );
    } else if (replicatesCluster(usableProvenance(batch))) {
      // ≥3 met but they cluster on one run/day — warn, don't block.
      warnings.push(
        `Credit batch ${batch.creditBatchCode}: all ${eligibility.usableReplicateCount} replicates cluster on a single run/day — §8.3.1 expects ≥3 independent samples distributed across distinct runs/days. Confirm this is a registry-agreed sampling alternative.`,
      );
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

  // (d) Method B cadence — across a production process's batch set, ≥ ceil(N /
  // cadence) batches must be sampled (§8.3.1.2). Method A's per-batch obligation
  // is covered by (b); Method B's 1-in-10 cadence is a cross-batch property, so
  // group by production process (every batch of a process shares its single
  // derived method) and block when the sampled count falls short — otherwise an
  // all-unsampled Method B removal would read as ready. Method B is an inert seam
  // today (DEC runs Method A everywhere); the path is kept correct for the
  // deferred unlock.
  const batchesByProcess = new Map<string, BatchGateFacts[]>();
  for (const batch of batches) {
    const key = batch.productionProcessId ?? batch.creditBatchId;
    const existing = batchesByProcess.get(key);
    if (existing) existing.push(batch);
    else batchesByProcess.set(key, [batch]);
  }
  for (const processBatches of batchesByProcess.values()) {
    if (processBatches[0].samplingMethod !== "method_b") continue;
    const requirement = deriveSamplingRequirement(
      "method_b",
      processBatches.map((batch) => ({
        runId: batch.creditBatchId,
        runCode: batch.creditBatchCode,
        sampleCount: batch.replicates.length,
      })),
    );
    if (requirement.cadenceShortfall > 0) {
      blockers.push(
        `Method B process batch set samples ${requirement.sampledRuns}/${requirement.requiredSampledRuns} required batch(es) (≥ 1 per ${METHOD_B_SAMPLING_CADENCE_RUNS}); sample ${requirement.cadenceShortfall} more before submission (§8.3.1.2).`,
      );
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}
