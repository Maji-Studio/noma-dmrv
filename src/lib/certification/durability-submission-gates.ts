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

import { METHOD_B_SAMPLING_CADENCE_RUNS } from "@/config/certification";
import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  MINIMUM_REPLICATES_PER_RUN,
  O_TO_C_ORG_ELIGIBILITY_MAX,
  evaluateReplicateCount,
  evaluateRunEligibility,
  type ReplicateRatios,
} from "@/lib/calculations/biochar-eligibility";
import {
  deriveSamplingRequirement,
  type SamplingMethod,
} from "./sampling-requirements";

export interface RunGateFacts {
  runId: string;
  runCode: string;
  /** The reactor this run belongs to — runs are grouped by it for cadence (d). */
  reactorId: string;
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
    const sampleRowCount = run.replicates.length;

    // (b) Method A presence — every Method A run must be sampled.
    if (sampleRowCount === 0) {
      if (run.samplingMethod === "method_a") {
        blockers.push(
          `Run ${run.runCode} (Method A) has no samples — every Method A run must be sampled before submission (§8.3).`,
        );
      }
      // Method B unsampled run is valid (submits via the unsampled blueprint);
      // its cadence is enforced across the reactor's run set in (d) below.
      continue;
    }

    const eligibility = evaluateRunEligibility(run.replicates);

    // (c) Replicate sufficiency — a sampled run needs ≥ 3 COMPLETE-chemistry
    // replicates. A row without a usable H/C_org + O/C_org pair doesn't
    // characterise the batch, so count usable replicates, not raw rows (§4).
    const replicateCheck = evaluateReplicateCount(
      eligibility.usableReplicateCount,
    );
    if (!replicateCheck.meetsMinimum) {
      blockers.push(
        `Run ${run.runCode} has ${eligibility.usableReplicateCount} replicate(s) with complete H/C_org + O/C_org chemistry; ≥ ${MINIMUM_REPLICATES_PER_RUN} required per sampled run (§4).`,
      );
    }

    // (a) Eligibility — judged on the replicate mean (D8); indeterminate fails closed.
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

  // (d) Method B cadence — across a reactor's run set, ≥ ceil(N / cadence)
  // batches must be sampled (§8.3.1.2). Method A's per-run obligation is covered
  // by (b); Method B's 1-in-10 cadence is a cross-run property, so group by
  // reactor (every run of a reactor shares its single derived method) and block
  // when the sampled count falls short — otherwise an all-unsampled Method B
  // removal would read as ready.
  const runsByReactor = new Map<string, RunGateFacts[]>();
  for (const run of runs) {
    const existing = runsByReactor.get(run.reactorId);
    if (existing) existing.push(run);
    else runsByReactor.set(run.reactorId, [run]);
  }
  for (const reactorRuns of runsByReactor.values()) {
    if (reactorRuns[0].samplingMethod !== "method_b") continue;
    const requirement = deriveSamplingRequirement(
      "method_b",
      reactorRuns.map((run) => ({
        runId: run.runId,
        runCode: run.runCode,
        sampleCount: run.replicates.length,
      })),
    );
    if (requirement.cadenceShortfall > 0) {
      blockers.push(
        `Method B run set samples ${requirement.sampledRuns}/${requirement.requiredSampledRuns} required batch(es) (≥ 1 per ${METHOD_B_SAMPLING_CADENCE_RUNS}); sample ${requirement.cadenceShortfall} more before submission (§8.3.1.2).`,
      );
    }
  }

  return { ok: blockers.length === 0, blockers };
}
