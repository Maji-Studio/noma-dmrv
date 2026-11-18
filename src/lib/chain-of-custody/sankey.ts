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

import {
  extractLineageFacts,
  type LineageFacts,
  type MassBalanceLineage as SankeyLineage,
} from "./lineage-facts";
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
  /** Shared raw facts for the waterfall, extracted once before aggregation. */
  facts: LineageFacts;
  /** Ordered main-flow columns: feedstock → runs → lots → applied. */
  columns: SankeyColumn[];
  /** Non-zero labeled exits, in flow order. */
  exits: SankeyExit[];
  /** Raw signed sum of residuals not shown and within EXIT_EPSILON_KG. */
  omittedResidualKg: number;
  /** Mass-balance inconsistencies (negative residuals clamped to zero). */
  warnings: string[];
}

export type { MassBalanceLineage as SankeyLineage } from "./lineage-facts";

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

  const facts = extractLineageFacts(lineages);
  const { feedstockInKg, runOutputKg, lotMassKg, appliedKg } = facts;

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
      label: facts.hasProductAllocations ? "Outside these applications" : "Not bagged into lots",
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
    facts,
    columns: [
      {
        key: "feedstock",
        label: "Feedstock",
        massKg: feedstockInKg,
        count: facts.feedstockCount,
      },
      {
        key: "productionRuns",
        label: "Production runs",
        massKg: runOutputKg,
        count: facts.runs.length,
      },
      {
        key: "biocharLots",
        label: facts.hasProductAllocations ? "Allocated biochar" : "Biochar lots",
        massKg: lotMassKg,
        count: facts.products.length,
      },
      {
        key: "applied",
        label: "Applied",
        massKg: appliedKg,
        count: facts.applications.length,
      },
    ],
    exits,
    omittedResidualKg,
    warnings,
  };
}
