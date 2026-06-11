/**
 * Credit-batch mass-balance Sankey — the pure aggregation behind the batch
 * view's Sankey reading (plan: 2026-06-11-chain-of-custody-views, decision 3).
 *
 * One unit (dry kg) end to end: Feedstock → Production runs → Biochar lots →
 * Applied. Every loss is an explicit labeled exit, never hidden by
 * normalizing column widths:
 *
 *   - ineligible feedstock exits the feedstock column (the >25% Isometric
 *     cap made visible — `creditBatches.ineligibleFeedstockMassKg`);
 *   - conversion loss (pyrolysis syngas/vapour/ash — expected physics, not an
 *     error) exits at the production runs;
 *   - output never bagged into a lot exits between runs and lots;
 *   - in-storage / undelivered lot mass exits before "Applied".
 *
 * The terminal node is the batch's applied mass; net tCO₂e is a label, not a
 * ribbon. Mirrors `buildMassAccounting`'s walk (lineages + deduped runs) but
 * keeps full run masses — the exits, not attribution fractions, account for
 * mass that never reached this batch's applications.
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
  /** Label only, never a ribbon (stored − emissions − counterfactual). */
  netCo2eRemovalTons: number | null;
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
  feedstocks: { id: string; massUsedKg: number | null }[];
}

export interface SankeyBatchFacts {
  ineligibleFeedstockMassKg: number | null;
  totalCo2eStoredTons: number | null;
  totalCo2eEmissionsTons: number | null;
  totalCo2eCounterfactualTons: number | null;
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
  batch: SankeyBatchFacts,
): CreditBatchSankeyData {
  const warnings: string[] = [];

  // Dedupe shared entities across member applications: N applications may
  // draw from the same run / lot (plan decision 1 — run-deduped roll-up).
  const runById = new Map<string, NonNullable<SankeyLineage["productionRun"]>>();
  const lotById = new Map<string, NonNullable<SankeyLineage["biocharProduct"]>>();
  const feedstockIds = new Set<string>();
  // Feedstock allocations keyed per run so a shared run's allocations count once.
  const allocationsByRunId = new Map<string, number>();

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
  const rawIneligibleKg = Math.max(0, batch.ineligibleFeedstockMassKg ?? 0);
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

  const netCo2eRemovalTons =
    batch.totalCo2eStoredTons == null
      ? null
      : batch.totalCo2eStoredTons -
        (batch.totalCo2eEmissionsTons ?? 0) -
        (batch.totalCo2eCounterfactualTons ?? 0);

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
    netCo2eRemovalTons,
    warnings,
  };
}
