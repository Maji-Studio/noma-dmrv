/**
 * Credit-batch mass-balance Sankey — the pure aggregation behind the batch
 * view's Sankey reading (plan: 2026-06-11-chain-of-custody-views, decision 3).
 *
 * One unit (dry kg) end to end: Feedstock → Production runs → Biochar lots →
 * Applied. Losses positive at display precision have explicit labeled exits
 * rather than normalized column widths:
 *
 *   - conversion loss (pyrolysis syngas/vapour/ash — expected physics, not an
 *     error) exits at the production runs;
 *   - output never bagged into a lot exits between runs and lots;
 *   - in-storage / undelivered lot mass exits before "Applied".
 * Exit masses are display-rounded differences of display-rounded columns.
 * Columns remain raw. Residuals not shown and within EXIT_EPSILON_KG are
 * summed raw, signed, in omittedResidualKg so consumers can close the balance.
 * Warnings use raw residuals and EXIT_EPSILON_KG.
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

import { sourceBiocharMassFlowKg } from "@/lib/biochar-product-mass";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { displayedDifferenceKg } from "@/lib/mass-precision";

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
  | "conversion_loss"
  | "unallocated_output"
  | "in_storage";

export interface SankeyExit {
  key: SankeyExitKey;
  label: string;
  /** Column the exit leaves from. */
  fromColumn: SankeyColumnKey;
  /** Display-rounded difference of display-rounded columns; columns and omittedResidualKg stay raw. */
  massKg: number;
  /** Raw signed upstream minus downstream for balance checks; massKg stays the display figure. */
  rawKg: number;
  /** alert = compliance-relevant (red); loss = expected/neutral exit. */
  tone: "alert" | "loss";
}

export interface CreditBatchSankeyData {
  /** Ordered main-flow columns: feedstock → runs → lots → applied. */
  columns: SankeyColumn[];
  /** Non-zero labeled exits, in flow order. */
  exits: SankeyExit[];
  /** Raw signed sum of residuals not shown and within EXIT_EPSILON_KG. */
  omittedResidualKg: number;
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
  biocharProduct: {
    id: string;
    massKg: number | null;
    moistureContentPercent: number | null;
    composition?: unknown;
  } | null;
  feedstocks: {
    id: string;
    /** Wet allocation. Converted proportionally against run dry mass below. */
    wetMassUsedKg: number | null;
  }[];
  /** Multi-run product provenance; absent on legacy one-run payloads. */
  sources?: {
    productionRun: NonNullable<SankeyLineage["productionRun"]>;
    feedstocks: SankeyLineage["feedstocks"];
    allocatedDryMassKg?: number | null;
  }[];
}

/** Raw residual tolerance for mass-balance warnings. */
export const EXIT_EPSILON_KG = 0.5;

interface ResidualResult {
  raw: number;
  value: number;
  shown: boolean;
  warning: string | null;
}

// A negative residual means downstream mass exceeds upstream mass — a data
// inconsistency, never a renderable exit. Clamp and say so.
function residual(
  upstreamKg: number,
  downstreamKg: number,
  inconsistencyWarning: string,
): ResidualResult {
  const raw = upstreamKg - downstreamKg;
  // Subtract the displayed columns, rather than independently rounding
  // their raw difference. Keep raw masses for tolerance and warnings.
  const value = Math.max(0, displayedDifferenceKg(upstreamKg, downstreamKg));
  return {
    raw,
    value,
    shown: value > 0,
    warning: raw < -EXIT_EPSILON_KG ? inconsistencyWarning : null,
  };
}

export function buildBatchSankey(
  lineages: readonly SankeyLineage[],
): CreditBatchSankeyData {
  const warnings: string[] = [];

  // Dedupe shared entities across member applications: N applications may
  // draw from the same run / lot (plan decision 1 — run-deduped roll-up).
  const runById = new Map<string, NonNullable<SankeyLineage["productionRun"]>>();
  const allocatedByProductId = new Map<string, number>();
  const lotById = new Map<string, NonNullable<SankeyLineage["biocharProduct"]>>();
  const feedstockIds = new Set<string>();
  const applicationIds = new Set<string>();
  let appliedKg = 0;
  for (const lineage of lineages) {
    applicationIds.add(lineage.application.id);
    appliedKg += tonnesToKg(lineage.application.biocharAppliedDryTons ?? 0);
    const sources =
      lineage.sources && lineage.sources.length > 0
        ? lineage.sources
        : lineage.productionRun
          ? [{
              productionRun: lineage.productionRun,
              feedstocks: lineage.feedstocks,
            }]
          : [];
    for (const source of sources) {
      const productionRun = source.productionRun;
      runById.set(productionRun.id, productionRun);
      for (const feedstock of source.feedstocks) {
        feedstockIds.add(feedstock.id);
      }
    }
    if (lineage.biocharProduct) {
      lotById.set(lineage.biocharProduct.id, lineage.biocharProduct);
      if (lineage.sources?.every(source => source.allocatedDryMassKg != null)) {
        allocatedByProductId.set(lineage.biocharProduct.id,
          (allocatedByProductId.get(lineage.biocharProduct.id) ?? 0) +
          lineage.sources.reduce((sum, source) => sum + (source.allocatedDryMassKg ?? 0), 0));
      }
    }
  }

  let feedstockInKg = 0;
  let runOutputKg = 0;
  for (const run of runById.values()) {
    // The run-derived dry input is the only dry feedstock basis. Wet bin
    // allocations must never be substituted into this dry-mass Sankey.
    feedstockInKg += run.feedstockMassDryKg ?? 0;
    runOutputKg += run.biocharDryMassKg ?? 0;
  }

  // Share the dashboard's allocation-first, ingredient-excluded biochar basis.
  // Without a dry figure, retain only the source biochar's wet mass.
  let lotMassKg = 0;
  for (const lot of lotById.values()) {
    lotMassKg += sourceBiocharMassFlowKg({
      ...lot,
      composition: lot.composition,
      sourceAllocatedDryMassKg: allocatedByProductId.get(lot.id) ?? null,
    });
  }

  const conversionLoss = residual(
    feedstockInKg,
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
  if (conversionLoss.shown) {
    exits.push({
      key: "conversion_loss",
      label: "Conversion loss",
      fromColumn: "productionRuns",
      massKg: conversionLoss.value,
      rawKg: conversionLoss.raw,
      tone: "loss",
    });
  }
  if (unallocated.shown) {
    exits.push({
      key: "unallocated_output",
      label: allocatedByProductId.size ? "Outside these applications" : "Not bagged into lots",
      fromColumn: "productionRuns",
      massKg: unallocated.value,
      rawKg: unallocated.raw,
      tone: "loss",
    });
  }
  if (inStorage.shown) {
    exits.push({
      key: "in_storage",
      label: "In storage / undelivered",
      fromColumn: "biocharLots",
      massKg: inStorage.value,
      rawKg: inStorage.raw,
      tone: "loss",
    });
  }
  const omittedResidualKg = [conversionLoss, unallocated, inStorage]
    .reduce((sum, { raw, shown, warning }) => sum + (!shown && !warning ? raw : 0), 0);

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
        label: allocatedByProductId.size ? "Allocated biochar" : "Biochar lots",
        massKg: lotMassKg,
        count: lotById.size,
      },
      {
        key: "applied",
        label: "Applied",
        massKg: appliedKg,
        count: applicationIds.size,
      },
    ],
    exits,
    omittedResidualKg,
    warnings,
  };
}
