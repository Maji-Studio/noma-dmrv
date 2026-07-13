/**
 * Method-driven sampling-requirement engine — the pure decisions behind a
 * credit batch's effective Method A/B regime and the resulting process cadence.
 *
 * Grain (ADR 0016 / ADR 0017): the sampling unit is the CREDIT BATCH — the
 * protocol production batch — never the production run. A credit batch's
 * `sampleCount` is its POOLED replicate count across its member runs/days.
 *
 * The requirement is DERIVED, never stored. A process unlock does not rewrite
 * history: batches starting before or on the unlock date remain Method A; only
 * later batches use Method B (ADR 0017). Callers pass batches from one effective
 * regime that are still in scope; this module judges the set it is given.
 *
 * ─── AUTHORITATIVE SOURCE (pinned, see docs/isometric/versions.json) ─────────
 *   Biochar Protocol 1.2 (tag 1.2.0)
 *   https://registry.isometric.com/protocol/biochar/1.2?tag=1.2.0
 *   §8.3      Method A — sample EVERY production batch.
 *   §8.3.1.2  Method B — sample ≥ 1 per 10 production batches (`G-2W0F-0`), after
 *             the 30-Method-A-sample baseline (enforced separately at the
 *             production-process level, `getMethodBEligibilityByProcess`).
 *   §4 (module) — each sampled batch pools ≥ 3 replicates.
 *
 * Client-safe (no server-only imports), mirroring `readiness.ts`, so the
 * sampling readiness UI, the removal readiness facts, and the submission gates
 * share one verdict. Non-authoritative summary — verify against the URL before
 * relying on it for credit claims.
 */

import { METHOD_B_SAMPLING_CADENCE_BATCHES } from "@/config/certification";
import { MINIMUM_REPLICATES_PER_BATCH } from "@/lib/calculations/biochar-eligibility";

export type SamplingMethod = "method_a" | "method_b";

/**
 * Resolve the immutable sampling regime for one batch from its process state.
 * Credit-batch starts are date-only while the unlock is a timestamp, so a batch
 * starting on the unlock calendar date remains Method A. Invalid or incomplete
 * transition data fails closed to Method A.
 */
export function deriveBatchSamplingMethod(params: {
  processMethod: SamplingMethod;
  methodBUnlockedAt: Date | string | null;
  batchStartDate: Date | string;
}): SamplingMethod {
  if (params.processMethod !== "method_b" || params.methodBUnlockedAt == null) {
    return "method_a";
  }

  const batchStartDate = toIsoDate(params.batchStartDate);
  const unlockDate = toIsoDate(params.methodBUnlockedAt);
  if (batchStartDate == null || unlockDate == null) return "method_a";

  return batchStartDate > unlockDate ? "method_b" : "method_a";
}

function toIsoDate(value: Date | string): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }

  const dateOnlyMatch = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value);
  if (dateOnlyMatch) {
    const dateOnly = dateOnlyMatch[1];
    const parsedDateOnly = new Date(`${dateOnly}T00:00:00.000Z`);
    return !Number.isNaN(parsedDateOnly.getTime()) &&
      parsedDateOnly.toISOString().slice(0, 10) === dateOnly
      ? dateOnly
      : null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** One in-scope credit batch and how many replicate samples it pools. */
export interface BatchSampling {
  batchId: string;
  batchCode: string;
  /** Pooled replicate count across the batch's member runs/days (0 = unsampled). */
  sampleCount: number;
}

export interface SamplingRequirement {
  method: SamplingMethod;
  totalBatches: number;
  /** Batches carrying ≥ 1 sample. */
  sampledBatches: number;
  /** Minimum sampled batches the method requires across this batch set. */
  requiredSampledBatches: number;
  /** `requiredSampledBatches − sampledBatches`, floored at 0. */
  cadenceShortfall: number;
  /**
   * Method A: ids of batches that MUST be sampled but aren't (every batch is
   * required). Method B has no per-batch obligation — any 1-in-10 satisfies the
   * cadence — so this is always empty for Method B; use `cadenceShortfall`.
   */
  unsampledRequiredBatchIds: string[];
  /** Sampled batches whose pooled replicates fall below the ≥3 minimum (§4). */
  underReplicatedBatchIds: string[];
  /** True when the method's sampling cadence is satisfied (no shortfall). */
  met: boolean;
}

/**
 * Derive the sampling requirement for one effective regime's in-scope credit
 * batches. Pure over its inputs — no I/O, no DB types.
 */
export function deriveSamplingRequirement(
  method: SamplingMethod,
  batches: BatchSampling[],
): SamplingRequirement {
  const totalBatches = batches.length;
  const sampledBatches = batches.filter((b) => b.sampleCount > 0).length;

  // Method A requires every batch sampled; Method B requires ceil(N/10) — at
  // least one once any batch exists.
  const requiredSampledBatches =
    method === "method_a"
      ? totalBatches
      : totalBatches === 0
        ? 0
        : Math.max(1, Math.ceil(totalBatches / METHOD_B_SAMPLING_CADENCE_BATCHES));

  const cadenceShortfall = Math.max(0, requiredSampledBatches - sampledBatches);

  const unsampledRequiredBatchIds =
    method === "method_a"
      ? batches.filter((b) => b.sampleCount <= 0).map((b) => b.batchId)
      : [];

  // A batch's ≥3 replicates may be POOLED across its member runs/days, so judge
  // the batch's total pooled count — not any single run's — fixing the stale
  // per-run check that over-required sampling.
  const underReplicatedBatchIds = batches
    .filter((b) => b.sampleCount > 0 && b.sampleCount < MINIMUM_REPLICATES_PER_BATCH)
    .map((b) => b.batchId);

  return {
    method,
    totalBatches,
    sampledBatches,
    requiredSampledBatches,
    cadenceShortfall,
    unsampledRequiredBatchIds,
    underReplicatedBatchIds,
    met: cadenceShortfall === 0,
  };
}
