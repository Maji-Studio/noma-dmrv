/**
 * Credit-batch mass-balance Sankey — the pure aggregation behind the batch
 * view's Sankey reading (plan: 2026-06-11-chain-of-custody-views, decision 3).
 *
 * One unit (dry kg) end to end: Feedstock → Production runs → Biochar lots →
 * Applied. Every loss is an explicit labeled exit, never hidden by
 * normalizing column widths:
 *
 *   - ineligible feedstock exits the feedstock column (the >25% Isometric
 *     cap made visible — derived from the lineage's run-feedstock allocations
 *     whose feedstock is flagged `eligibilityStatus = 'ineligible'`);
 *   - conversion loss (pyrolysis syngas/vapour/ash — expected physics, not an
 *     error) exits at the production runs;
 *   - output never bagged into a lot exits between runs and lots;
 *   - in-storage / undelivered lot mass exits before "Applied".
 *
 * The terminal node is the batch's applied mass. No net-tCO₂e figure is
 * carried at all — the registry owns project emissions/counterfactual
 * (ADR 0018, issue #285), so no honest local net exists. Mirrors
 * `buildMassAccounting`'s walk (lineages + deduped runs) but keeps full run
 * masses — the exits, not attribution fractions, account for mass that never
 * reached this batch's applications.
 *
 * Pure and dependency-light (same contract as
 * `@/lib/certification/mass-accounting`): takes the already-resolved lineage
 * payloads via narrow structural params so it stays unit-testable and free of
 * any data-access / "use server" coupling.
 */

import { tonnesToKg } from "@/lib/calculations/unit-conversions";

export type SankeyColumnKey =
  | "feedstock"
  | "productionRuns"
  | "biocharLots"
  | "applied";

export interface SankeyColumn {
  key: SankeyColumnKey;
  label: string;
  /** Dry mass represented by this column (kg). */
  massKg: number;
  /** Distinct entities aggregated into the column. */
  count: number;
}

export type SankeyExitKey =
  | "ineligible_feedstock"
  | "conversion_loss"
  | "unallocated_output"
  | "in_storage";

export interface SankeyExit {
  key: SankeyExitKey;
  label: string;
  /** Column the exit leaves from. */
  fromColumn: SankeyColumnKey;
  massKg: number;
  /** alert = compliance-relevant (red); loss = expected/neutral exit. */
  tone: "alert" | "loss";
}

export interface CreditBatchSankeyData {
  /** Ordered main-flow columns: feedstock → runs → lots → applied. */
  columns: SankeyColumn[];
  /** Non-zero labeled exits, in flow order. */
  exits: SankeyExit[];
  /** Mass-balance inconsistencies (negative residuals clamped to zero). */
  warnings: string[];
}

// Only the fields the aggregation reads — structurally satisfied by
// `ChainOfCustodyData` at the call site.
export interface SankeyLineage {
  application: { id: string; biocharAppliedDryTons: number | null };
  productionRun: {
    id: string;
    feedstockMassDryKg: number | null;
    biocharDryMassKg: number | null;
  } | null;
  biocharProduct: { id: string; massKg: number | null } | null;
  feedstocks: {
    id: string;
    massUsedKg: number | null;
    eligibilityStatus: "eligible" | "ineligible" | "conditional" | null;
  }[];
}

/** Residuals smaller than this are rounding noise, not a labeled exit. */
const EXIT_EPSILON_KG = 0.5;

interface ResidualResult {
  value: number;
  warning: string | null;
}

// A negative residual means downstream mass exceeds upstream mass — a data
// inconsistency, never a renderable exit. Clamp and say so.
function residual(
  upstreamKg: number,
  downstreamKg: number,
  inconsistencyWarning: string,
): ResidualResult {
  const value = upstreamKg - downstreamKg;
  if (value < -EXIT_EPSILON_KG) {
    return { value: 0, warning: inconsistencyWarning };
  }
  return { value: Math.max(0, value), warning: null };
}

export function buildBatchSankey(
  lineages: readonly SankeyLineage[],
): CreditBatchSankeyData {
  const warnings: string[] = [];

  // Dedupe shared entities across member applications: N applications may
  // draw from the same run / lot (plan decision 1 — run-deduped roll-up).
  const runById = new Map<string, NonNullable<SankeyLineage["productionRun"]>>();
  const lotById = new Map<string, NonNullable<SankeyLineage["biocharProduct"]>>();
  const feedstockIds = new Set<string>();
  // Feedstock allocations keyed per run so a shared run's allocations count once.
  const allocationsByRunId = new Map<string, number>();
  // Ineligible slice of each run's allocations (issue #285): derived from the
  // lineage's feedstock eligibility flags, deduped per run like the totals.
  const ineligibleAllocationsByRunId = new Map<string, number>();

  let appliedKg = 0;
  for (const lineage of lineages) {
    appliedKg += tonnesToKg(lineage.application.biocharAppliedDryTons ?? 0);
    if (lineage.productionRun) {
      runById.set(lineage.productionRun.id, lineage.productionRun);
      if (!allocationsByRunId.has(lineage.productionRun.id)) {
        allocationsByRunId.set(
          lineage.productionRun.id,
          lineage.feedstocks.reduce((sum, f) => sum + (f.massUsedKg ?? 0), 0),
        );
        ineligibleAllocationsByRunId.set(
          lineage.productionRun.id,
          lineage.feedstocks.reduce(
            (sum, f) =>
              f.eligibilityStatus === "ineligible"
                ? sum + (f.massUsedKg ?? 0)
                : sum,
            0,
          ),
        );
      }
    }
    if (lineage.biocharProduct) {
      lotById.set(lineage.biocharProduct.id, lineage.biocharProduct);
    }
    for (const feedstock of lineage.feedstocks) {
      feedstockIds.add(feedstock.id);
    }
  }

  let feedstockInKg = 0;
  let runOutputKg = 0;
  for (const run of runById.values()) {
    // The run's recorded feedstock input is authoritative; fall back to the
    // sum of its allocation records when the run total was never captured.
    feedstockInKg +=
      run.feedstockMassDryKg ?? allocationsByRunId.get(run.id) ?? 0;
    runOutputKg += run.biocharDryMassKg ?? 0;
  }

  let lotMassKg = 0;
  for (const lot of lotById.values()) {
    lotMassKg += lot.massKg ?? 0;
  }

  // The ineligible exit can never carry more than the column it leaves from.
  const rawIneligibleKg = Math.max(
    0,
    Array.from(ineligibleAllocationsByRunId.values()).reduce(
      (sum, kg) => sum + kg,
      0,
    ),
  );
  const ineligibleKg = Math.min(rawIneligibleKg, feedstockInKg);
  if (rawIneligibleKg > feedstockInKg + EXIT_EPSILON_KG) {
    warnings.push(
      "Recorded ineligible feedstock mass exceeds the lineage's total feedstock input.",
    );
  }

  const conversionLoss = residual(
    feedstockInKg - ineligibleKg,
    runOutputKg,
    "Production-run biochar output exceeds the feedstock mass entering the runs.",
  );
  if (conversionLoss.warning) warnings.push(conversionLoss.warning);

  const unallocated = residual(
    runOutputKg,
    lotMassKg,
    "Biochar lot mass exceeds the production runs' recorded output.",
  );
  if (unallocated.warning) warnings.push(unallocated.warning);

  const inStorage = residual(
    lotMassKg,
    appliedKg,
    "Applied mass exceeds the biochar lots' recorded mass.",
  );
  if (inStorage.warning) warnings.push(inStorage.warning);

  const exits: SankeyExit[] = [];
  if (ineligibleKg > EXIT_EPSILON_KG) {
    exits.push({
      key: "ineligible_feedstock",
      label: "Ineligible feedstock",
      fromColumn: "feedstock",
      massKg: ineligibleKg,
      tone: "alert",
    });
  }
  if (conversionLoss.value > EXIT_EPSILON_KG) {
    exits.push({
      key: "conversion_loss",
      label: "Conversion loss",
      fromColumn: "productionRuns",
      massKg: conversionLoss.value,
      tone: "loss",
    });
  }
  if (unallocated.value > EXIT_EPSILON_KG) {
    exits.push({
      key: "unallocated_output",
      label: "Not bagged into lots",
      fromColumn: "productionRuns",
      massKg: unallocated.value,
      tone: "loss",
    });
  }
  if (inStorage.value > EXIT_EPSILON_KG) {
    exits.push({
      key: "in_storage",
      label: "In storage / undelivered",
      fromColumn: "biocharLots",
      massKg: inStorage.value,
      tone: "loss",
    });
  }

  return {
    columns: [
      {
        key: "feedstock",
        label: "Feedstock",
        massKg: feedstockInKg,
        count: feedstockIds.size,
      },
      {
        key: "productionRuns",
        label: "Production runs",
        massKg: runOutputKg,
        count: runById.size,
      },
      {
        key: "biocharLots",
        label: "Biochar lots",
        massKg: lotMassKg,
        count: lotById.size,
      },
      {
        key: "applied",
        label: "Applied",
        massKg: appliedKg,
        count: lineages.length,
      },
    ],
    exits,
    warnings,
  };
}

// ============================================
// Facility-wide stage flow (dashboard custody ribbon, Phase 5)
// ============================================

/**
 * Facility-wide dry-mass stage totals — already summed by the caller. Unlike
 * `buildBatchSankey` there is no lineage walk: dashboard scale means "every
 * run / lot / application at the facility in the period", which the data
 * layer aggregates in SQL instead of resolving N per-application rollbacks.
 */
export interface StageFlowTotals {
  /** Sum of the runs' recorded feedstock input (dry kg). */
  feedstockInKg: number;
  /** Sum of the runs' biochar output (dry kg). */
  runOutputKg: number;
  /** Sum of the biochar lots' mass (kg). */
  lotMassKg: number;
  /** Sum of the applications' applied dry mass (kg). */
  appliedKg: number;
  counts: {
    feedstocks: number;
    productionRuns: number;
    biocharLots: number;
    applications: number;
  };
}

/**
 * The dashboard's custody-flow ribbon reading — the same honest mass-balance
 * grammar as the batch Sankey (columns + explicit labeled exits, negative
 * residuals clamped to a warning) computed from facility-wide stage totals.
 * The batch-level ineligible-feedstock exit has no facility-period analogue,
 * so the exits here are conversion loss, unbagged output, and in-storage.
 */
export function buildStageFlow(totals: StageFlowTotals): CreditBatchSankeyData {
  const warnings: string[] = [];

  const conversionLoss = residual(
    totals.feedstockInKg,
    totals.runOutputKg,
    "Production-run biochar output exceeds the feedstock mass entering the runs.",
  );
  if (conversionLoss.warning) warnings.push(conversionLoss.warning);

  const unallocated = residual(
    totals.runOutputKg,
    totals.lotMassKg,
    "Biochar lot mass exceeds the production runs' recorded output.",
  );
  if (unallocated.warning) warnings.push(unallocated.warning);

  const inStorage = residual(
    totals.lotMassKg,
    totals.appliedKg,
    "Applied mass exceeds the biochar lots' recorded mass.",
  );
  if (inStorage.warning) warnings.push(inStorage.warning);

  const exits: SankeyExit[] = [];
  if (conversionLoss.value > EXIT_EPSILON_KG) {
    exits.push({
      key: "conversion_loss",
      label: "Conversion loss",
      fromColumn: "productionRuns",
      massKg: conversionLoss.value,
      tone: "loss",
    });
  }
  if (unallocated.value > EXIT_EPSILON_KG) {
    exits.push({
      key: "unallocated_output",
      label: "Not bagged into lots",
      fromColumn: "productionRuns",
      massKg: unallocated.value,
      tone: "loss",
    });
  }
  if (inStorage.value > EXIT_EPSILON_KG) {
    exits.push({
      key: "in_storage",
      label: "In storage / undelivered",
      fromColumn: "biocharLots",
      massKg: inStorage.value,
      tone: "loss",
    });
  }

  return {
    columns: [
      {
        key: "feedstock",
        label: "Feedstock",
        massKg: totals.feedstockInKg,
        count: totals.counts.feedstocks,
      },
      {
        key: "productionRuns",
        label: "Production runs",
        massKg: totals.runOutputKg,
        count: totals.counts.productionRuns,
      },
      {
        key: "biocharLots",
        label: "Biochar lots",
        massKg: totals.lotMassKg,
        count: totals.counts.biocharLots,
      },
      {
        key: "applied",
        label: "Applied",
        massKg: totals.appliedKg,
        count: totals.counts.applications,
      },
    ],
    exits,
    warnings,
  };
}
