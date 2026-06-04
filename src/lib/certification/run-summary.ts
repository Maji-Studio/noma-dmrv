/**
 * Removal run summary — the focused aggregate the guided Review flow shows so
 * an operator can see *what's being submitted* at a glance: how many production
 * runs feed the removal, their total biochar output, and the applied dry mass
 * this removal actually claims (ADR 0003 — a removal counts only the biochar
 * that reached soil).
 *
 * Pure and dependency-light: it takes the two arrays the submission context
 * already resolves (the application lineages + the deduped production runs) via
 * narrow structural params, so it stays unit-testable and free of any
 * data-access / "use server" coupling. `appliedDryKg / totalBiocharOutputKg`
 * is the overall attribution the submit pipeline scopes by per run.
 */

import { tonnesToKg } from "@/lib/calculations/unit-conversions";

export interface RemovalRunSummary {
  /** Distinct production runs feeding this removal. */
  runCount: number;
  /** Σ run.biocharDryMassKg across those runs (raw output, the denominator). */
  totalBiocharOutputKg: number;
  /**
   * Σ applied biochar dry mass reaching this removal's applications (the
   * numerator). Mirrors `buildAttribution`'s per-run accumulation, totalled.
   */
  appliedDryKg: number;
}

export const EMPTY_RUN_SUMMARY: RemovalRunSummary = {
  runCount: 0,
  totalBiocharOutputKg: 0,
  appliedDryKg: 0,
};

// Only the fields the summary reads — structurally satisfied by
// `ChainOfCustodyData` / `ProductionRunWithSamples` at the call site.
interface AppliedLineage {
  productionRun: { id: string } | null;
  application: { biocharAppliedDryTons: number | null };
}

interface RunOutput {
  biocharDryMassKg: number | null;
}

export function buildRunSummary(
  lineages: readonly AppliedLineage[],
  runs: readonly RunOutput[],
): RemovalRunSummary {
  let appliedDryKg = 0;
  for (const lineage of lineages) {
    // Skip lineages that never resolve to a run — they contribute no run mass.
    if (!lineage.productionRun?.id) continue;
    appliedDryKg += tonnesToKg(lineage.application.biocharAppliedDryTons ?? 0);
  }

  let totalBiocharOutputKg = 0;
  for (const run of runs) {
    totalBiocharOutputKg += run.biocharDryMassKg ?? 0;
  }

  return {
    runCount: runs.length,
    totalBiocharOutputKg,
    appliedDryKg,
  };
}
