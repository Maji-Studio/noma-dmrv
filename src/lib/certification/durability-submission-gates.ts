/**
 * Durability submission gates — the protocol's hard, fail-closed sampling and
 * eligibility blocks evaluated at removal-submission time (decision D3). These
 * promote what used to be method-blind logged warnings
 * (`aggregation.ts` "no samples") into protocol-correct, method-aware hard
 * blocks:
 *
 *   (a) Eligibility — the run's replicate MEAN must satisfy H/C_org < 0.5 AND
 *       O/C_org < 0.2 (module §3 Table 2, judged per D8). Indeterminate
 *       chemistry (a missing ratio) fails closed.
 *   (b) Sampling presence — every Method A run must carry ≥ 1 sample (§8.3). A
 *       Method B run MAY be unsampled (it submits via the unsampled blueprint),
 *       so it is not blocked here.
 *   (c) Replicate sufficiency — any SAMPLED run must carry ≥ 3 replicates (§4).
 *
 * Pure and client-safe — the submission orchestrator (`submit-removal.ts`)
 * assembles the per-run facts and throws a single SafeError on the blockers.
 * The COA / lab-report Source requirement (D4) lives with the measurement-sample
 * chemistry datapoints (Phase E), not here.
 */

import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  MINIMUM_REPLICATES_PER_RUN,
  O_TO_C_ORG_ELIGIBILITY_MAX,
  evaluateReplicateCount,
  evaluateRunEligibility,
  type ReplicateRatios,
} from "@/lib/calculations/biochar-eligibility";
import type { SamplingMethod } from "./sampling-requirements";

export interface RunGateFacts {
  runId: string;
  runCode: string;
  /** The run's reactor's CURRENT sampling method (D6 — derived, never stored). */
  samplingMethod: SamplingMethod;
  /** Per-replicate stability ratios (one entry per `Sample` row on the run). */
  replicates: ReplicateRatios[];
}

export interface DurabilitySubmissionGateResult {
  ok: boolean;
  /** One human-readable blocker line per failed gate, ready to join into a SafeError. */
  blockers: string[];
}

/**
 * Evaluate the D3 gates over a removal's runs. Returns every blocker (so the
 * operator sees all sampling/eligibility problems at once, not one at a time).
 */
export function evaluateDurabilitySubmissionGates(
  runs: RunGateFacts[],
): DurabilitySubmissionGateResult {
  const blockers: string[] = [];

  for (const run of runs) {
    const replicateCount = run.replicates.length;

    // (b) Method A presence — every Method A run must be sampled.
    if (replicateCount === 0) {
      if (run.samplingMethod === "method_a") {
        blockers.push(
          `Run ${run.runCode} (Method A) has no samples — every Method A run must be sampled before submission (§8.3).`,
        );
      }
      // Method B unsampled run is valid (submits via the unsampled blueprint).
      continue;
    }

    // (c) Replicate sufficiency — a sampled run needs ≥ 3 replicates.
    const replicateCheck = evaluateReplicateCount(replicateCount);
    if (!replicateCheck.meetsMinimum) {
      blockers.push(
        `Run ${run.runCode} has ${replicateCount} replicate(s); ≥ ${MINIMUM_REPLICATES_PER_RUN} required per sampled run (§4).`,
      );
    }

    // (a) Eligibility — judged on the replicate mean (D8); indeterminate fails closed.
    const eligibility = evaluateRunEligibility(run.replicates);
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
        `Run ${run.runCode} fails biochar eligibility (${parts.join("; ")}) — module §3 Table 2.`,
      );
    } else if (eligibility.eligible === null) {
      blockers.push(
        `Run ${run.runCode} eligibility is indeterminate — missing H/C_org or O/C_org chemistry; cannot confirm it meets module §3 Table 2.`,
      );
    }
  }

  return { ok: blockers.length === 0, blockers };
}
