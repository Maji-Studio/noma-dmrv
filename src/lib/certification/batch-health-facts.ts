/**
 * Adapter: a single credit batch's removal Certify context → the per-batch
 * health facts the classifier judges. The batch-grain sibling of
 * `toRemovalReadinessFacts` (./readiness-facts) — kept separate from the pure
 * classifier (`batch-health.ts`) so that module stays free of the context
 * shape. Client-safe: a type-only context import plus plain string mapping.
 *
 * For an UNGROUPED batch, `loadCertifyContextForCreditBatchForUser` resolves a
 * 1:1 scope, so the context's transport coverage / `hasSubmittableRuns` /
 * member durability gates describe THIS batch alone — exactly the per-batch facts the
 * selection gate needs. For an already-grouped batch the context reflects its
 * removal's aggregate; the detail page tolerates that (it's a viewing aid), and
 * the wizard only ever health-checks ungrouped batches.
 */

import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { MINIMUM_REPLICATES_PER_BATCH } from "@/lib/calculations/biochar-eligibility";
import type { BatchHealthFacts } from "./batch-health";
import { STORED_CO2E_PREVIEW_REVERIFICATION_GAP } from "./preview-gaps";

// Preview keys owned by other UI checks. Credit-batch detail may still explain
// local preview gaps, but Removal readiness is derived from the independent
// durability gates below.
const NON_CARBON_MISSING_INPUTS = new Set([
  "applicationIds",
  "facilityCertifierProject",
  "isometricCertifier",
  STORED_CO2E_PREVIEW_REVERIFICATION_GAP,
]);

const CARBON_INPUT_LABELS: Record<string, string> = {
  organicCarbonPercent: "Organic carbon content",
  dryMassTonnes: "Dry biochar applied",
  soilTemperatureC: "Soil temperature",
  hToCorgRatio: "H:Corg ratio",
  thousandYearReplicates: `At least ${MINIMUM_REPLICATES_PER_BATCH} usable 1000-year Samples`,
  meanRandomReflectancePercent: "Mean random reflectance (R₀)",
  stdRandomReflectance: "Std dev of R₀",
  meanNonReactiveCarbonPercent: "Mean non-reactive carbon",
  stdNonReactiveCarbonPercent: "Std dev of non-reactive carbon",
};

/**
 * The genuine carbon/durability gaps in a CO₂e-stored preview, as human labels.
 * Shared with the credit-batch detail's "CO₂e stored" field so the number's
 * absence is explained in the SAME words the health check uses.
 */
export function carbonGapLabels(missingInputs: readonly string[]): string[] {
  return Array.from(
    new Set(
      missingInputs
        .filter((key) => !NON_CARBON_MISSING_INPUTS.has(key))
        .map((key) => CARBON_INPUT_LABELS[key] ?? key),
    ),
  );
}

function carbonMissingInputs(
  ctx: RemovalCertifyContext,
  batchId: string,
): string[] {
  const member = ctx.memberBatches.find((b) => b.id === batchId);
  return Array.from(new Set(member?.durabilityGateBlockers ?? []));
}

// The facility's project mapping + default template resolve cleanly. Transport
// requirements come from the template, so transport is only evaluable once true
// (mirrors `templateResolvesCleanly` in readiness.ts, plus the mapping gate).
function isFacilitySetupComplete(ctx: RemovalCertifyContext): boolean {
  return (
    !!ctx.mapping &&
    !!ctx.defaultTemplate &&
    !ctx.missingDefaultTemplateId &&
    ctx.unresolvedBlueprintKeys.length === 0
  );
}

export function toBatchHealthFacts(
  ctx: RemovalCertifyContext,
  batchId: string,
): BatchHealthFacts {
  return {
    carbonMissingInputs: carbonMissingInputs(ctx, batchId),
    facilityEmissionsBlockers:
      ctx.memberBatches.find((batch) => batch.id === batchId)
        ?.facilityEmissionsGateBlockers ?? [],
    feedstockTypeMappingGaps: (ctx.feedstockTypeMappingGaps ?? []).filter(
      (gap) => gap.creditBatchId === batchId,
    ),
    entityReadinessGaps: ctx.entityReadinessGaps ?? [],
    entityReadinessIssues: ctx.entityReadinessIssues ?? [],
    hasSubmittableRuns: ctx.hasSubmittableRuns,
    productionReadinessGap: ctx.productionReadinessGap ?? null,
    facilitySetupComplete: isFacilitySetupComplete(ctx),
    requiredTransport: ctx.requiredTransportCategories.map((category) => ({
      category,
      present: ctx.transportCoverage[category].count > 0,
    })),
  };
}
