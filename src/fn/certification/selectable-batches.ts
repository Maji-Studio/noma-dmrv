import { env } from "@/config/env";
import {
  listUngroupedCreditBatches,
  type UngroupedCreditBatchRow,
} from "@/data-access/certifier-removals";
import {
  deriveBatchHealth,
  type BatchHealth,
} from "@/lib/certification/batch-health";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import {
  deriveFacilitySetupGaps,
  type FacilitySetupGap,
} from "@/lib/certification/facility-setup-gaps";
import type { OrgContext } from "@/lib/auth/server";
import type {
  CreditBatchContextSet,
  FacilityCertifierFacts,
} from "./certify-context-core";

// One ungrouped credit batch with its per-batch health verdict — a selection
// card in the New-Removal wizard's first step.
export interface SelectableBatch extends UngroupedCreditBatchRow {
  health: BatchHealth;
  // Derived on read (issue #285): Σ member applications' biocharAppliedTons.
  appliedWeightTons: number;
  // Derived on read (issue #285): the same CO₂e stored preview figure the
  // credit-batch detail page shows; null while preview inputs are incomplete.
  co2eStoredTonnes: number | null;
}

export interface SelectableBatchesData {
  batches: SelectableBatch[];
  // Facility setup (project mapping + cleanly-resolving default template) is
  // done. When false the wizard shows a "finish facility setup" banner and the
  // transport health check on each batch reads `skipped` (design doc §8).
  facilitySetupComplete: boolean;
  // Names each unmet setup prerequisite (QA 2026-07-21 F2); empty ⇔ complete.
  facilitySetupGaps: FacilitySetupGap[];
  // Whether a submit from this facility writes to the production registry —
  // drives the wizard's production confirmation gate.
  isProduction: boolean;
}

type BuildCreditBatchContexts = (
  orgCtx: OrgContext,
  creditBatchIds: string[],
  facilityFacts: FacilityCertifierFacts,
) => Promise<CreditBatchContextSet>;

// Builds the New-Removal wizard's selection-step payload after the core action
// has authorized the facility and loaded its certifier facts. Loads accounting
// once and reuses the assembled records across every selection card.
export async function buildSelectableBatchesData(
  orgCtx: OrgContext,
  facilityId: string,
  facilityFacts: FacilityCertifierFacts,
  buildCreditBatchContexts: BuildCreditBatchContexts,
): Promise<SelectableBatchesData> {
  const ungrouped = await listUngroupedCreditBatches(orgCtx, facilityId);
  const ungroupedIds = ungrouped.map((row) => row.id);
  const { accountingByBatch, contextsByBatch } = await buildCreditBatchContexts(
    orgCtx,
    ungroupedIds,
    facilityFacts,
  );
  const batches: SelectableBatch[] = ungrouped.map((row) => {
    const accounting = accountingByBatch[row.id];
    const context = contextsByBatch[row.id];
    return {
      ...row,
      health: deriveBatchHealth(toBatchHealthFacts(context, row.id)),
      appliedWeightTons: accounting?.appliedWeightTons ?? 0,
      co2eStoredTonnes: accounting?.co2ePreview.co2eStoredTonnes ?? null,
    };
  });
  const facilitySetupGaps = deriveFacilitySetupGaps(facilityFacts);
  return {
    batches,
    facilitySetupComplete: facilitySetupGaps.length === 0,
    facilitySetupGaps,
    isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
  };
}
