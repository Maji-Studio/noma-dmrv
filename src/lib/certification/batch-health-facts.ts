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
import type { BatchHealthFacts } from "./batch-health";

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
