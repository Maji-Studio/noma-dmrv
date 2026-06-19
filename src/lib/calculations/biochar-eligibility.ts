/**
 * Biochar sample-eligibility gates — the protocol's hard characterization
 * thresholds, evaluated on the PER-RUN MEAN of a production run's replicate
 * samples (decision D8), plus the per-run replicate-count minimum.
 *
 * ─── AUTHORITATIVE SOURCE (pinned, see docs/isometric/versions.json) ─────────
 *   Module "Biochar Storage in Soil Environments" v1.2 (CERTIFIED, tag 1.2.0)
 *   https://registry.isometric.com/module/biochar-storage-soil-environments/1.2?tag=1.2.0
 *
 *   §3, Table 2  Eligibility: molar H/C_org < 0.5 AND molar O/C_org < 0.2.
 *   §4           Each sampling's composite is divided into ≥ 3 representative
 *                replicates per batch (production run).
 *
 * Eligibility is judged on the run's REPLICATE MEAN (D8): the run's
 * characterization is the mean of its replicates, with any individually
 * out-of-spec replicate surfaced as a flagged outlier rather than failing the
 * whole run. This module is pure and client-safe (no server-only imports) so
 * the sample form, readiness engine, and submission gates share one verdict.
 *
 * NOTE: any summary of the protocol is non-authoritative — verify against the
 * URL above before relying on this output for credit claims.
 */

// ── Pinned protocol thresholds ───────────────────────────────────────────────

/** Maximum molar H/C_org for an eligible biochar (§3, Table 2). Strict (<). */
export const H_TO_C_ORG_ELIGIBILITY_MAX = 0.5;

/** Maximum molar O/C_org for an eligible biochar (§3, Table 2). Strict (<). */
export const O_TO_C_ORG_ELIGIBILITY_MAX = 0.2;

/** Minimum representative replicates per sampled production run (§4). */
export const MINIMUM_REPLICATES_PER_RUN = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isUsableNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ── Per-run eligibility (Eq. eligibility, §3 Table 2) ────────────────────────

/** A single lab-analysed replicate's stability ratios (a noma `Sample` row). */
export interface ReplicateRatios {
  /** Molar hydrogen / organic-carbon ratio (dimensionless). */
  hToCOrgRatio?: number | null;
  /** Molar oxygen / organic-carbon ratio (dimensionless). */
  oToCOrgRatio?: number | null;
}

export interface RunEligibilityResult {
  /**
   * Run-level verdict: `true`/`false` once both means are determinable;
   * `null` when a required mean is missing (no usable replicate) — callers that
   * gate on eligibility must treat `null` as "cannot confirm eligible" (block).
   */
  eligible: boolean | null;
  meanHToCOrgRatio: number | null;
  meanOToCOrgRatio: number | null;
  /** Per-mean threshold checks; `null` when the corresponding mean is missing. */
  hToCWithinThreshold: boolean | null;
  oToCWithinThreshold: boolean | null;
  /**
   * 0-based indexes of replicates that, on their own, breach a threshold. These
   * are FLAGGED for attention (D8), not a per-replicate hard fail — the run can
   * still be eligible on its mean.
   */
  outlierReplicateIndexes: number[];
  /**
   * Replicates carrying BOTH a usable H/C_org and O/C_org — the set the
   * eligibility verdict is judged on (D8). The §4 replicate-sufficiency gate
   * counts these (complete-chemistry replicates), not raw rows, so a sampled run
   * with incomplete chemistry can never read eligible on a single paired sample.
   */
  usableReplicateCount: number;
  warnings: string[];
}

/**
 * Evaluate a production run's eligibility from its replicate samples. The
 * thresholds are applied to the replicate MEAN (D8); individually out-of-spec
 * replicates are returned in `outlierReplicateIndexes` as advisories.
 */
export function evaluateRunEligibility(
  replicates: ReplicateRatios[],
): RunEligibilityResult {
  const warnings: string[] = [];

  const hValues = replicates
    .map((r) => r.hToCOrgRatio)
    .filter(isUsableNumber);
  const oValues = replicates
    .map((r) => r.oToCOrgRatio)
    .filter(isUsableNumber);

  const meanHToCOrgRatio = meanOf(hValues);
  const meanOToCOrgRatio = meanOf(oValues);

  const hToCWithinThreshold =
    meanHToCOrgRatio == null
      ? null
      : meanHToCOrgRatio < H_TO_C_ORG_ELIGIBILITY_MAX;
  const oToCWithinThreshold =
    meanOToCOrgRatio == null
      ? null
      : meanOToCOrgRatio < O_TO_C_ORG_ELIGIBILITY_MAX;

  if (meanHToCOrgRatio == null) {
    warnings.push("No usable H/C_org replicate — eligibility indeterminate.");
  }
  if (meanOToCOrgRatio == null) {
    warnings.push("No usable O/C_org replicate — eligibility indeterminate.");
  }

  // The eligibility VERDICT is judged only on replicates carrying BOTH ratios, so
  // a run can never read "eligible" from a disjoint mix — H/C from one replicate,
  // O/C from another — that never co-occurred in one characterized replicate. The
  // per-ratio means above stay independent (for surfacing); the verdict below
  // uses the paired set.
  const pairedReplicates = replicates.filter(
    (r): r is { hToCOrgRatio: number; oToCOrgRatio: number } =>
      isUsableNumber(r.hToCOrgRatio) && isUsableNumber(r.oToCOrgRatio),
  );
  const usableReplicateCount = pairedReplicates.length;
  const pairedMeanHToCOrgRatio = meanOf(
    pairedReplicates.map((r) => r.hToCOrgRatio),
  );
  const pairedMeanOToCOrgRatio = meanOf(
    pairedReplicates.map((r) => r.oToCOrgRatio),
  );
  if (replicates.length > 0 && usableReplicateCount < replicates.length) {
    warnings.push(
      "Some replicates are missing H/C_org or O/C_org; eligibility is judged only on replicates with complete paired chemistry.",
    );
  }

  // An outlier is a replicate that would be ineligible on its own (same
  // ceilings, strict). Flag it even when the run mean passes (D8).
  const outlierReplicateIndexes: number[] = [];
  replicates.forEach((r, index) => {
    const hOut =
      isUsableNumber(r.hToCOrgRatio) &&
      r.hToCOrgRatio >= H_TO_C_ORG_ELIGIBILITY_MAX;
    const oOut =
      isUsableNumber(r.oToCOrgRatio) &&
      r.oToCOrgRatio >= O_TO_C_ORG_ELIGIBILITY_MAX;
    if (hOut || oOut) outlierReplicateIndexes.push(index);
  });
  if (outlierReplicateIndexes.length > 0) {
    warnings.push(
      `${outlierReplicateIndexes.length} replicate(s) individually exceed the eligibility ceilings (H/C_org ≥ ${H_TO_C_ORG_ELIGIBILITY_MAX} or O/C_org ≥ ${O_TO_C_ORG_ELIGIBILITY_MAX}); review for an outlier.`,
    );
  }

  // Eligibility needs BOTH ceilings met on the PAIRED mean. Indeterminate (null)
  // when no replicate carries complete chemistry — never silently "eligible" on
  // incomplete or disjoint chemistry.
  const eligible =
    pairedMeanHToCOrgRatio == null || pairedMeanOToCOrgRatio == null
      ? null
      : pairedMeanHToCOrgRatio < H_TO_C_ORG_ELIGIBILITY_MAX &&
        pairedMeanOToCOrgRatio < O_TO_C_ORG_ELIGIBILITY_MAX;

  return {
    eligible,
    meanHToCOrgRatio,
    meanOToCOrgRatio,
    hToCWithinThreshold,
    oToCWithinThreshold,
    outlierReplicateIndexes,
    usableReplicateCount,
    warnings,
  };
}

// ── Per-run replicate count (§4 — ≥3 per run) ────────────────────────────────

export interface ReplicateCountResult {
  count: number;
  minimum: number;
  meetsMinimum: boolean;
}

/**
 * Whether a sampled run carries the protocol minimum of ≥3 replicates (§4).
 * Takes a count so callers can pass `run.samples.length` directly.
 */
export function evaluateReplicateCount(count: number): ReplicateCountResult {
  return {
    count,
    minimum: MINIMUM_REPLICATES_PER_RUN,
    meetsMinimum: count >= MINIMUM_REPLICATES_PER_RUN,
  };
}
