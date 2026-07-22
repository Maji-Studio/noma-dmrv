import { env } from "@/config/env";
import { getCo2eStoredPreviews } from "@/data-access/credit-batches";
import {
  loadCreditBatchLineageFacts,
  type CreditBatchLineageFacts,
} from "@/data-access/credit-batch-lineage-facts";
import { getApplicationRollupsByBatchIds } from "@/data-access/credit-batch-production-runs";
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
  FacilityCertifierFacts,
  RemovalCertifyContext,
} from "./certify-context-core";

const FANOUT_CONCURRENCY = 8;

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

type BuildCreditBatchContext = (
  orgCtx: OrgContext,
  creditBatchId: string,
  facilityFacts: FacilityCertifierFacts,
  lineageFacts?: CreditBatchLineageFacts,
) => Promise<RemovalCertifyContext>;

// Builds the New-Removal wizard's selection-step payload after the core action
// has authorized the facility and loaded its certifier facts. Loads lineage
// facts ONCE and reuses them across every batch's preview and context build.
export async function buildSelectableBatchesData(
  orgCtx: OrgContext,
  facilityId: string,
  facilityFacts: FacilityCertifierFacts,
  buildCreditBatchContext: BuildCreditBatchContext,
): Promise<SelectableBatchesData> {
  const ungrouped = await listUngroupedCreditBatches(orgCtx, facilityId);
  const ungroupedIds = ungrouped.map((row) => row.id);
  // One set-based lineage load feeds both the CO₂e preview builder and every
  // per-batch certify-context build below.
  const lineageFactsByBatch = await loadCreditBatchLineageFacts(
    orgCtx,
    ungroupedIds,
  );
  const applicationRollups = await getApplicationRollupsByBatchIds(
    orgCtx,
    ungroupedIds,
  );
  const co2ePreviews = await getCo2eStoredPreviews(orgCtx, ungroupedIds, {
    applicationRollups,
    lineageFactsByBatch,
  });
  // Bounded chunks (order-preserving) rather than one unbounded Promise.all
  // over every ungrouped batch — see FANOUT_CONCURRENCY.
  const batches: SelectableBatch[] = [];
  for (let i = 0; i < ungrouped.length; i += FANOUT_CONCURRENCY) {
    const chunk = await Promise.all(
      ungrouped.slice(i, i + FANOUT_CONCURRENCY).map(async (row) => {
        const ctx = await buildCreditBatchContext(
          orgCtx,
          row.id,
          facilityFacts,
          lineageFactsByBatch[row.id],
        );
        return {
          ...row,
          health: deriveBatchHealth(toBatchHealthFacts(ctx, row.id)),
          appliedWeightTons:
            applicationRollups[row.id]?.appliedWeightTons ?? 0,
          co2eStoredTonnes: co2ePreviews[row.id]?.co2eStoredTonnes ?? null,
        };
      }),
    );
    batches.push(...chunk);
  }
  const facilitySetupGaps = deriveFacilitySetupGaps(facilityFacts);
  return {
    batches,
    facilitySetupComplete: facilitySetupGaps.length === 0,
    facilitySetupGaps,
    isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
  };
}
