/**
 * Method-driven sampling-requirement engine — the single pure decision behind
 * "given a reactor's CURRENT sampling method and its production runs, how many
 * must be sampled, and is the requirement met?" (decision D6).
 *
 * The requirement is DERIVED, never stored: it is computed from the reactor's
 * live `samplingMethod` at readiness/submission time, so flipping the method
 * auto-readjusts what's required. Callers pass only the runs that are still in
 * scope (not yet frozen into a submitted removal); this module judges the set
 * it is given.
 *
 * ─── AUTHORITATIVE SOURCE (pinned, see docs/isometric/versions.json) ─────────
 *   Biochar Protocol 1.2 (tag 1.2.0)
 *   https://registry.isometric.com/protocol/biochar/1.2?tag=1.2.0
 *   §8.3      Method A — sample EVERY production batch.
 *   §8.3.1.2  Method B — sample ≥ 1 per 10 production batches (`G-2W0F-0`), after
 *             the 30-Method-A-sample baseline (enforced separately at the reactor
 *             level, `getMethodBEligibilityByReactor`).
 *   §4 (module) — each sampled run carries ≥ 3 replicates.
 *
 * Client-safe (no server-only imports), mirroring `readiness.ts`, so the reactor
 * readiness UI, the removal readiness facts, and the submission gates share one
 * verdict. Non-authoritative summary — verify against the URL before relying on
 * it for credit claims.
 */

import { METHOD_B_SAMPLING_CADENCE_RUNS } from "@/config/certification";
import { MINIMUM_REPLICATES_PER_RUN } from "@/lib/calculations/biochar-eligibility";

export type SamplingMethod = "method_a" | "method_b";

/** One in-scope production run and how many replicate samples it carries. */
export interface RunSampling {
  runId: string;
  runCode: string;
  /** Number of replicate samples attached to the run (0 = unsampled). */
  sampleCount: number;
}

export interface SamplingRequirement {
  method: SamplingMethod;
  totalRuns: number;
  /** Runs carrying ≥ 1 sample. */
  sampledRuns: number;
  /** Minimum sampled runs the method requires across this run set. */
  requiredSampledRuns: number;
  /** `requiredSampledRuns − sampledRuns`, floored at 0. */
  cadenceShortfall: number;
  /**
   * Method A: ids of runs that MUST be sampled but aren't (every run is
   * required). Method B has no per-run obligation — any 1-in-10 satisfies the
   * cadence — so this is always empty for Method B; use `cadenceShortfall`.
   */
  unsampledRequiredRunIds: string[];
  /** Sampled runs below the ≥3-replicate minimum (module §4). */
  underReplicatedRunIds: string[];
  /** True when the method's sampling cadence is satisfied (no shortfall). */
  met: boolean;
}

/**
 * Derive the sampling requirement for a reactor's in-scope runs under its
 * current method. Pure over its inputs — no I/O, no DB types.
 */
export function deriveSamplingRequirement(
  method: SamplingMethod,
  runs: RunSampling[],
): SamplingRequirement {
  const totalRuns = runs.length;
  const sampledRuns = runs.filter((r) => r.sampleCount > 0).length;

  // Method A requires every run sampled; Method B requires ceil(N/10) — at
  // least one once any run exists.
  const requiredSampledRuns =
    method === "method_a"
      ? totalRuns
      : totalRuns === 0
        ? 0
        : Math.max(1, Math.ceil(totalRuns / METHOD_B_SAMPLING_CADENCE_RUNS));

  const cadenceShortfall = Math.max(0, requiredSampledRuns - sampledRuns);

  const unsampledRequiredRunIds =
    method === "method_a"
      ? runs.filter((r) => r.sampleCount <= 0).map((r) => r.runId)
      : [];

  const underReplicatedRunIds = runs
    .filter((r) => r.sampleCount > 0 && r.sampleCount < MINIMUM_REPLICATES_PER_RUN)
    .map((r) => r.runId);

  return {
    method,
    totalRuns,
    sampledRuns,
    requiredSampledRuns,
    cadenceShortfall,
    unsampledRequiredRunIds,
    underReplicatedRunIds,
    met: cadenceShortfall === 0,
  };
}
