/**
 * Adapter: a single credit batch's removal Certify context → the per-batch
 * health facts the classifier judges. The batch-grain sibling of
 * `toRemovalReadinessFacts` (./readiness-facts) — kept separate from the pure
 * classifier (`batch-health.ts`) so that module stays free of the context
 * shape. Client-safe: a type-only context import plus plain string mapping.
 *
 * For an UNGROUPED batch, `loadCertifyContextForCreditBatchForUser` resolves a
 * 1:1 scope, so the context's transport coverage / `hasSubmittableRuns` /
 * member preview describe THIS batch alone — exactly the per-batch facts the
 * selection gate needs. For an already-grouped batch the context reflects its
 * removal's aggregate; the detail page tolerates that (it's a viewing aid), and
 * the wizard only ever health-checks ungrouped batches.
 */

import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { MINIMUM_REPLICATES_PER_BATCH } from "@/lib/calculations/biochar-eligibility";
import type { BatchHealthFacts } from "./batch-health";

// Preview `missingInputs` keys owned by OTHER health checks (or by the
// removal-level requirements step), excluded here so each concern reports once:
//   applicationIds          → the production check (no lineage runs)
//   facilityCertifierProject / isometricCertifier → facility setup (wizard)
const NON_CARBON_MISSING_INPUTS = new Set([
  "applicationIds",
  "facilityCertifierProject",
  "isometricCertifier",
]);

// Human labels for the genuine carbon/durability gaps the CO2e-stored preview
// reports (see `computeApplicationCo2eStored` + `buildCo2eStoredPreview`).
// Unknown keys pass through unchanged so a new calc input never silently
// disappears from the health check.
const CARBON_INPUT_LABELS: Record<string, string> = {
  organicCarbonPercent: "Organic carbon content",
  dryMassTonnes: "Applied biochar dry mass",
  soilTemperatureC: "Soil temperature",
  hToCorgRatio: "H:Corg ratio",
  // 1000-year blueprint-parity preview gap: < 3 complete (total carbon +
  // s_fraction) replicates — see computeApplicationCo2eStoredBlueprint1000.
  thousandYearReplicates: `At least ${MINIMUM_REPLICATES_PER_BATCH} usable 1000-year lab samples`,
  // 1000-year (Eq.6) petrography/TGA gaps — issue #142.
  meanRandomReflectancePercent: "Mean random reflectance (R₀)",
  stdRandomReflectance: "Std dev of R₀",
  meanNonReactiveCarbonPercent: "Mean non-reactive carbon",
  stdNonReactiveCarbonPercent: "Std dev of non-reactive carbon",
};

function carbonMissingInputs(
  ctx: RemovalCertifyContext,
  batchId: string,
): string[] {
  const member = ctx.memberBatches.find((b) => b.id === batchId);
  const raw = member?.co2eStoredPreview?.missingInputs ?? [];
  return Array.from(
    new Set(
      [
        ...raw
          .filter((key) => !NON_CARBON_MISSING_INPUTS.has(key))
          .map((key) => CARBON_INPUT_LABELS[key] ?? key),
        ...(member?.durabilityGateBlockers ?? []),
      ],
    ),
  );
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
