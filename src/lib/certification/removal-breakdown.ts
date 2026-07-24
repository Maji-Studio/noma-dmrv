/**
 * Removal carbon-accounting breakdown — the pure aggregation behind the
 * removal detail sheet's breakdown card. It mirrors the Isometric registry's
 * mental model for a GHG entry:
 *
 *     Sequestrations  −  Activities  −  Uncertainty discount  =  Net CO₂e removed
 *
 * Two figure sources, reconciled here so the UI never has to:
 *
 *  - **Local** (always available pre- and post-submission): gross CO₂e stored
 *    (the certify preview, our Sequestrations), project emissions (Activities)
 *    and counterfactual, summed across the removal's member credit batches.
 *  - **Registry** (only once submitted): the authoritative net removed, the
 *    pre-uncertainty figure, the standard deviation behind the uncertainty
 *    discount and the buffer-pool split, read back from the GHG entry.
 *
 * Registry figures can exist while their GHG statement is still a draft. The
 * statement link and status therefore travel with the figures so the UI can
 * distinguish a registry draft from genuinely verified accounting.
 *
 * All public figures are kg CO₂e (the registry's unit); the display layer
 * down-converts to tonnes. Pure and IO-free so the math is unit-testable.
 */

import type { RemoteGhgStatus } from "./status";

const TONNE_KG = 1000;

// Local Sequestrations and the registry's pre-uncertainty figure are computed
// independently, so rounding and minor input drift can make them disagree by a
// hair. Within this tolerance we treat them as the same number and render one
// reconciled waterfall; beyond it the registry figure is authoritative and the
// card flags the divergence rather than showing a sum that doesn't add up.
const RECONCILE_ABS_TOLERANCE_KG = 1;
const RECONCILE_REL_TOLERANCE = 0.01;

export type RemovalBreakdownSource = "registry" | "estimate";

export type RemovalBreakdownAnomaly =
  | "net-negative"
  | "net-exceeds-before-discount"
  | "sequestration-missing-or-zero";

export interface RemovalBreakdownRegistryVerification {
  /** Registry GHG statement linked from the GHG entry; null means draft. */
  ghgStatementId: string | null;
  /** Live statement status when readable; unknown/missing stays null. */
  ghgStatementStatus: RemoteGhgStatus | null;
}

/** Registry-side figures read back from a submitted GHG entry (kg CO₂e). */
export interface RemovalBreakdownRegistryInput {
  /** `co2e_net_removed_kg` — net once uncertainty discounting is applied. */
  netRemovedKg: number;
  /** `co2e_net_removed_without_discount_kg` — net before the uncertainty haircut. */
  netBeforeDiscountKg: number;
  /** `co2e_net_removed_standard_deviation_kg` — the spread the discount reflects. */
  standardDeviationKg: number | null;
  /** `risk_of_reversal_percentage` — the buffer-pool contribution rate. */
  riskOfReversalPercent: number | null;
  /** `credit_allocation.buffer_pool_contribution_kg`. */
  bufferCreditsKg: number | null;
  /** `credit_allocation.supplier_allocation_kg`. */
  supplierCreditsKg: number | null;
  /** `ghg_statement_id` from the GHG entry; null means the entry is a draft. */
  ghgStatementId: string | null;
  /** Status of the linked GHG statement, when the registry read succeeds. */
  ghgStatementStatus: RemoteGhgStatus | null;
}

export interface RemovalBreakdownInput {
  /** Per member-batch gross CO₂e stored (tonnes), null where the preview is incomplete. */
  sequestrationTonnesByBatch: (number | null)[];
  /** Per member-batch project emissions (tonnes), null when not recorded. */
  emissionsTonnesByBatch: (number | null)[];
  /** Per member-batch counterfactual baseline (tonnes), null when not recorded. */
  counterfactualTonnesByBatch: (number | null)[];
  /** Why the sequestration preview is incomplete (deduped input keys). */
  missingInputs: string[];
  memberBatchCount: number;
  /** Registry figures, or null when the removal is not yet submitted/verified. */
  registry: RemovalBreakdownRegistryInput | null;
}

export interface RemovalCarbonBreakdown {
  source: RemovalBreakdownSource;
  /** Gross CO₂e stored across member batches; null until every batch preview resolves. */
  sequestrationKg: number | null;
  sequestrationComplete: boolean;
  /** Project emissions (Activities). 0 when none recorded — see `activitiesRecorded`. */
  activitiesKg: number;
  activitiesRecorded: boolean;
  /** Counterfactual baseline. 0 when none recorded — see `counterfactualRecorded`. */
  counterfactualKg: number;
  counterfactualRecorded: boolean;
  /** Our own seq − activities − counterfactual; null when sequestration is incomplete. */
  localNetBeforeDiscountKg: number | null;
  /** Pre-uncertainty net: the registry's figure when verified, else the local one. */
  netBeforeDiscountKg: number | null;
  /** Registry-only; null for a draft estimate (uncertainty is set at verification). */
  uncertaintyDiscountKg: number | null;
  standardDeviationKg: number | null;
  /** The headline: registry's verified net when submitted, else the local estimate. */
  netRemovedKg: number | null;
  bufferPoolPercent: number | null;
  bufferCreditsKg: number | null;
  supplierCreditsKg: number | null;
  /** Registry mode AND local pre-uncertainty figure agrees with the registry's. */
  reconciles: boolean;
  missingInputs: string[];
  memberBatchCount: number;
  /** False when there is nothing meaningful to show (no preview, no registry). */
  hasAnyData: boolean;
  /** Trust failures that suppress the normal positive-removal ledger. */
  anomalies: RemovalBreakdownAnomaly[];
  /** Registry statement identity/status used to gate verified presentation. */
  registryVerification: RemovalBreakdownRegistryVerification | null;
}

interface NullableSum {
  total: number;
  allPresent: boolean;
  anyPresent: boolean;
}

function sumNullable(values: (number | null)[]): NullableSum {
  let total = 0;
  let anyPresent = false;
  let allPresent = values.length > 0;
  for (const value of values) {
    if (value == null) {
      allPresent = false;
      continue;
    }
    anyPresent = true;
    total += value;
  }
  return { total, allPresent, anyPresent };
}

function toKg(tonnes: number): number {
  return tonnes * TONNE_KG;
}

function collectRegistryAnomalies(
  sequestrationKg: number | null,
  netRemovedKg: number,
  netBeforeDiscountKg: number,
): RemovalBreakdownAnomaly[] {
  const anomalies: RemovalBreakdownAnomaly[] = [];
  if (netRemovedKg < 0) {
    anomalies.push("net-negative");
  }
  if (netRemovedKg > netBeforeDiscountKg) {
    anomalies.push("net-exceeds-before-discount");
  }
  if (sequestrationKg != null && sequestrationKg <= 0) {
    anomalies.push("sequestration-missing-or-zero");
  }
  return anomalies;
}

function collectEstimateAnomalies(
  netRemovedKg: number | null,
): RemovalBreakdownAnomaly[] {
  return netRemovedKg != null && netRemovedKg < 0 ? ["net-negative"] : [];
}

function buildRegistryVerification(
  registry: RemovalBreakdownRegistryInput,
): RemovalBreakdownRegistryVerification {
  return {
    ghgStatementId: registry.ghgStatementId,
    ghgStatementStatus: registry.ghgStatementStatus,
  };
}

export function computeRemovalBreakdown(
  input: RemovalBreakdownInput,
): RemovalCarbonBreakdown {
  const sequestration = sumNullable(input.sequestrationTonnesByBatch);
  const emissions = sumNullable(input.emissionsTonnesByBatch);
  const counterfactual = sumNullable(input.counterfactualTonnesByBatch);

  const sequestrationComplete = sequestration.allPresent;
  const sequestrationKg = sequestrationComplete
    ? toKg(sequestration.total)
    : null;
  const activitiesKg = toKg(emissions.total);
  const counterfactualKg = toKg(counterfactual.total);

  const localNetBeforeDiscountKg =
    sequestrationKg == null
      ? null
      : sequestrationKg - activitiesKg - counterfactualKg;

  const { registry } = input;

  if (registry) {
    const uncertaintyDiscountKg = Math.max(
      0,
      registry.netBeforeDiscountKg - registry.netRemovedKg,
    );
    const reconciles =
      localNetBeforeDiscountKg != null &&
      Math.abs(localNetBeforeDiscountKg - registry.netBeforeDiscountKg) <=
        Math.max(
          RECONCILE_ABS_TOLERANCE_KG,
          Math.abs(registry.netBeforeDiscountKg) * RECONCILE_REL_TOLERANCE,
        );
    const anomalies = collectRegistryAnomalies(
      sequestrationKg,
      registry.netRemovedKg,
      registry.netBeforeDiscountKg,
    );

    return {
      source: "registry",
      sequestrationKg,
      sequestrationComplete,
      activitiesKg,
      activitiesRecorded: emissions.anyPresent,
      counterfactualKg,
      counterfactualRecorded: counterfactual.anyPresent,
      localNetBeforeDiscountKg,
      netBeforeDiscountKg: registry.netBeforeDiscountKg,
      uncertaintyDiscountKg,
      standardDeviationKg: registry.standardDeviationKg,
      netRemovedKg: registry.netRemovedKg,
      bufferPoolPercent: registry.riskOfReversalPercent,
      bufferCreditsKg: registry.bufferCreditsKg,
      supplierCreditsKg: registry.supplierCreditsKg,
      reconciles,
      missingInputs: input.missingInputs,
      memberBatchCount: input.memberBatchCount,
      hasAnyData: true,
      anomalies,
      registryVerification: buildRegistryVerification(registry),
    };
  }

  const anomalies = collectEstimateAnomalies(localNetBeforeDiscountKg);

  return {
    source: "estimate",
    sequestrationKg,
    sequestrationComplete,
    activitiesKg,
    activitiesRecorded: emissions.anyPresent,
    counterfactualKg,
    counterfactualRecorded: counterfactual.anyPresent,
    localNetBeforeDiscountKg,
    netBeforeDiscountKg: localNetBeforeDiscountKg,
    uncertaintyDiscountKg: null,
    standardDeviationKg: null,
    netRemovedKg: localNetBeforeDiscountKg,
    bufferPoolPercent: null,
    bufferCreditsKg: null,
    supplierCreditsKg: null,
    reconciles: false,
    missingInputs: input.missingInputs,
    memberBatchCount: input.memberBatchCount,
    hasAnyData:
      sequestration.anyPresent ||
      emissions.anyPresent ||
      counterfactual.anyPresent,
    anomalies,
    registryVerification: null,
  };
}
