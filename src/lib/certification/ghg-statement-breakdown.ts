/**
 * GHG-statement carbon-accounting breakdown — the pure aggregation behind the
 * statement detail sheet's breakdown card. A GHG statement is a period roll-up
 * of multiple removals (its member GHG entries), so its breakdown is the *sum*
 * over those members of the same story a single removal tells:
 *
 *     Sequestrations  −  Activities  −  Uncertainty discount  =  Net CO₂e removed
 *
 * The math is deliberately delegated to `computeRemovalBreakdown`: a statement's
 * local estimate is the sum across every member removal's batches (flatten the
 * batches and the per-batch arrays are identical to the single-removal case),
 * and the registry figures are the per-entry figures aggregated into one
 * `RemovalBreakdownRegistryInput`. So both cards share one reconciliation
 * discipline and can't drift.
 *
 * Aggregation rules (confirmed against Isometric's GHG-accounting module):
 *  - **Net** figures sum linearly: `Σ co2e_net_removed_kg`,
 *    `Σ co2e_net_removed_without_discount_kg`.
 *  - The **uncertainty discount** is then the difference of those two sums —
 *    derived downstream by `computeRemovalBreakdown`, never summed directly.
 *  - **Standard deviation** combines *in quadrature* (root sum of squares):
 *    the entries are independent sources of uncertainty, so summing linearly
 *    would overstate the spread.
 *  - The **buffer-pool split** is statement-level, not summable from entries —
 *    it is read from the statement's `credit_allocation` and the effective
 *    reversal rate is recovered from that split.
 *
 * Pure and IO-free so the aggregation is unit-testable.
 */

import {
  computeRemovalBreakdown,
  type RemovalBreakdownAnomaly,
  type RemovalBreakdownRegistryInput,
  type RemovalCarbonBreakdown,
} from "./removal-breakdown";
import type { RemoteGhgStatus } from "./status";

/** Per member GHG entry, read back from the registry (kg CO₂e). */
export interface GhgStatementEntryFigures {
  /** `co2e_net_removed_kg` — net once uncertainty discounting is applied. */
  netRemovedKg: number;
  /** `co2e_net_removed_without_discount_kg` — net before the uncertainty haircut. */
  netBeforeDiscountKg: number;
  /** `co2e_net_removed_standard_deviation_kg` — the entry's spread, or null. */
  standardDeviationKg: number | null;
}

/** The statement-level buffer/supplier split (`GhgStatement.credit_allocation`). */
export interface GhgStatementCreditAllocation {
  /** `buffer_pool_contribution_kg`. */
  bufferCreditsKg: number;
  /** `supplier_allocation_kg`. */
  supplierCreditsKg: number;
}

export interface GhgStatementBreakdownInput {
  /** Per member-batch gross CO₂e stored (tonnes), flattened across every member removal. */
  sequestrationTonnesByBatch: (number | null)[];
  /** Per member-batch project emissions (tonnes), flattened across every member removal. */
  emissionsTonnesByBatch: (number | null)[];
  /** Per member-batch counterfactual baseline (tonnes), flattened across every member removal. */
  counterfactualTonnesByBatch: (number | null)[];
  /** Why the sequestration preview is incomplete (deduped input keys). */
  missingInputs: string[];
  memberBatchCount: number;
  /**
   * One entry per member GHG entry, when every member removal's entry could be
   * read back; empty for a draft estimate (no submitted members, or the
   * registry read was incomplete — degrade to the local estimate rather than
   * sum a partial set).
   */
  entries: GhgStatementEntryFigures[];
  /** Statement-level buffer/supplier split, or null until the registry sets it. */
  creditAllocation: GhgStatementCreditAllocation | null;
  /** Registry statement id, null before the local statement has a remote id. */
  ghgStatementId: string | null;
  /** Live registry status when readable; unknown/missing stays unverified. */
  ghgStatementStatus: RemoteGhgStatus | null;
}

// Combine independent per-entry standard deviations in quadrature (root sum of
// squares) per Isometric's GHG-accounting uncertainty propagation: summing
// linearly would overstate the spread by ignoring that random errors partly
// cancel. Null when any entry omits its std-dev — a partial root-sum would
// understate, so we show nothing rather than a wrong number.
function combineStandardDeviation(
  entries: GhgStatementEntryFigures[],
): number | null {
  if (entries.length === 0) return null;
  let sumOfSquares = 0;
  for (const entry of entries) {
    if (entry.standardDeviationKg == null) return null;
    sumOfSquares += entry.standardDeviationKg ** 2;
  }
  return Math.sqrt(sumOfSquares);
}

// The statement's effective buffer rate = buffer / (buffer + supplier) × 100.
// Per Isometric's CreditAllocation, buffer = risk_of_reversal × issuable and
// supplier = issuable − buffer, so this recovers the credit-weighted reversal
// rate across entries. Rounded to a tenth so a blended rate stays legible.
function deriveBufferPercent(
  allocation: GhgStatementCreditAllocation | null,
): number | null {
  if (!allocation) return null;
  const issuableKg = allocation.bufferCreditsKg + allocation.supplierCreditsKg;
  if (issuableKg <= 0) return null;
  return Math.round((allocation.bufferCreditsKg / issuableKg) * 1000) / 10;
}

function aggregateRegistry(
  entries: GhgStatementEntryFigures[],
  allocation: GhgStatementCreditAllocation | null,
  ghgStatementId: string | null,
  ghgStatementStatus: RemoteGhgStatus | null,
): RemovalBreakdownRegistryInput {
  return {
    netRemovedKg: entries.reduce((sum, e) => sum + e.netRemovedKg, 0),
    netBeforeDiscountKg: entries.reduce(
      (sum, e) => sum + e.netBeforeDiscountKg,
      0,
    ),
    standardDeviationKg: combineStandardDeviation(entries),
    riskOfReversalPercent: deriveBufferPercent(allocation),
    bufferCreditsKg: allocation?.bufferCreditsKg ?? null,
    supplierCreditsKg: allocation?.supplierCreditsKg ?? null,
    ghgStatementId,
    ghgStatementStatus,
  };
}

function collectEntryAnomalies(
  entries: GhgStatementEntryFigures[],
): RemovalBreakdownAnomaly[] {
  const anomalies = new Set<RemovalBreakdownAnomaly>();
  for (const entry of entries) {
    if (entry.netRemovedKg < 0) {
      anomalies.add("net-negative");
    }
    if (entry.netRemovedKg > entry.netBeforeDiscountKg) {
      anomalies.add("net-exceeds-before-discount");
    }
  }
  return Array.from(anomalies);
}

export function computeGhgStatementBreakdown(
  input: GhgStatementBreakdownInput,
): RemovalCarbonBreakdown {
  // Entries present → registry roll-up; otherwise the local estimate over the
  // flattened member batches (identical shape to a single removal's estimate).
  const registry =
    input.entries.length > 0
      ? aggregateRegistry(
          input.entries,
          input.creditAllocation,
          input.ghgStatementId,
          input.ghgStatementStatus,
        )
      : null;

  const breakdown = computeRemovalBreakdown({
    sequestrationTonnesByBatch: input.sequestrationTonnesByBatch,
    emissionsTonnesByBatch: input.emissionsTonnesByBatch,
    counterfactualTonnesByBatch: input.counterfactualTonnesByBatch,
    missingInputs: input.missingInputs,
    memberBatchCount: input.memberBatchCount,
    registry,
  });

  if (input.entries.length === 0) return breakdown;
  return {
    ...breakdown,
    anomalies: Array.from(
      new Set([...breakdown.anomalies, ...collectEntryAnomalies(input.entries)]),
    ),
  };
}
