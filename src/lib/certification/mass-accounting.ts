/**
 * Removal mass accounting — the single lineage/run walk behind everything the
 * certification flow says about *what mass a removal submits*. One pass over the
 * application lineages + the deduped production runs produces BOTH:
 *
 *   - `runSummary` — the focused aggregate the guided Review flow shows (run
 *     count, total biochar output, applied dry mass) so an operator sees what's
 *     being submitted at a glance.
 *   - `attributionByRunId` — the per-run applied-biochar fraction the submit
 *     pipeline scopes STORED/DELIVERY-bucket quantities by, so a
 *     partially-applied run contributes only its applied share of those.
 *     PRODUCTION-bucket inputs are exempt: they front-load in full on the
 *     batch's claiming GHG entry (§8.6.2, issue #349, ADR 0020).
 *
 * Computing both from one walk is deliberate: the Review summary and the submit
 * payload share the same numerator (applied dry kg per run) and denominator
 * (run output), so the two can never drift (ADR 0003 as narrowed by ADR 0020 —
 * a removal's stored quantity counts only the biochar that reached soil).
 * `appliedDryKg / totalBiocharOutputKg` is the overall attribution; per run
 * it's `aggregateProductionRuns`'s scoping factor.
 *
 * Pure and dependency-light: it takes the two arrays the submission context
 * already resolves via narrow structural params, so it stays unit-testable and
 * free of any data-access / "use server" coupling.
 */

import { tonnesToKg } from "@/lib/calculations/unit-conversions";

export interface RemovalRunSummary {
  /** Distinct production runs feeding this removal. */
  runCount: number;
  /** Σ run.biocharDryMassKg across those runs (raw output, the denominator). */
  totalBiocharOutputKg: number;
  /**
   * Σ applied biochar dry mass reaching this removal's applications (the
   * numerator), totalled across runs.
   */
  appliedDryKg: number;
}

export interface RemovalMassAccounting {
  /**
   * Per-run applied-biochar fraction: applied dry kg reaching this removal's
   * applications ÷ the run's total biochar output (linear mass allocation). A
   * null/zero output can't yield a fraction — falls back to full attribution
   * (1); `aggregateProductionRuns` clamps each fraction into [0, 1] and warns
   * separately on null mass.
   */
  attributionByRunId: Map<string, number>;
  /** The Review-flow aggregate (see `RemovalRunSummary`). */
  runSummary: RemovalRunSummary;
}

export const EMPTY_RUN_SUMMARY: RemovalRunSummary = {
  runCount: 0,
  totalBiocharOutputKg: 0,
  appliedDryKg: 0,
};

/**
 * Removal-wide applied-biochar fraction — the DELIVERY-bucket scaling factor
 * (§8.6.2, issue #349, ADR 0020): appliedDryKg / totalBiocharOutputKg, falling
 * back to full attribution (1) when output is zero/absent, mirroring the
 * per-run fallback in `buildMassAccounting`. The ONE shared definition: both
 * the submitted biochar-transport scalar (`submitRemoval` →
 * `enrichWithTransportLegs`) and the transport evidence-ledger PDF's explicit
 * "× applied share" line derive from it, so the ledger always reconciles to
 * the submitted datapoint by construction.
 */
export function appliedBiocharFraction(summary: RemovalRunSummary): number {
  return summary.totalBiocharOutputKg > 0
    ? summary.appliedDryKg / summary.totalBiocharOutputKg
    : 1;
}

// Only the fields the accounting reads — structurally satisfied by
// `ChainOfCustodyData` / `ProductionRunWithSamples` at the call site.
interface AppliedLineage {
  productionRun: { id: string } | null;
  application: { biocharAppliedDryTons: number | null };
}

interface RunOutput {
  id: string;
  biocharDryMassKg: number | null;
}

/**
 * Walks the lineages once to accumulate applied dry kg per run (and its total),
 * then walks the runs once to sum output and derive each run's attribution
 * fraction. Lineages that never resolve to a production run contribute nothing.
 */
export function buildMassAccounting(
  lineages: readonly AppliedLineage[],
  runs: readonly RunOutput[],
): RemovalMassAccounting {
  // Applied dry kg reaching this removal's applications, accumulated per run
  // and totalled. Lineages with no resolved run carry no run mass.
  const appliedKgByRun = new Map<string, number>();
  let appliedDryKg = 0;
  for (const lineage of lineages) {
    const runId = lineage.productionRun?.id;
    if (!runId) continue;
    const appliedKg = tonnesToKg(lineage.application.biocharAppliedDryTons ?? 0);
    appliedKgByRun.set(runId, (appliedKgByRun.get(runId) ?? 0) + appliedKg);
    appliedDryKg += appliedKg;
  }

  let totalBiocharOutputKg = 0;
  const attributionByRunId = new Map<string, number>();
  for (const run of runs) {
    const output = run.biocharDryMassKg;
    totalBiocharOutputKg += output ?? 0;
    const appliedKg = appliedKgByRun.get(run.id) ?? 0;
    attributionByRunId.set(run.id, output && output > 0 ? appliedKg / output : 1);
  }

  return {
    attributionByRunId,
    runSummary: {
      runCount: runs.length,
      totalBiocharOutputKg,
      appliedDryKg,
    },
  };
}
