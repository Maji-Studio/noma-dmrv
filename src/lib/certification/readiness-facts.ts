/**
 * Adapter: the removal Certify context → the readiness facts the classifier
 * judges. The ONE projection both readiness surfaces share — the server-owned
 * Overview work queue (`fn/certification/overview.ts`) and the New-Removal
 * wizard's requirements step (`new-removal-dialog/`) — so a removal's verdict is
 * identical wherever it's computed, and neither side can drift from the other.
 *
 * Kept separate from `readiness.ts` (the pure classifier) so that module stays
 * free of the context shape. Client-safe: a type-only context import plus the
 * client-safe `isLockedInFlight`.
 */

import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import type { RemovalReadinessFacts } from "./readiness";

export function toRemovalReadinessFacts(
  ctx: RemovalCertifyContext,
): RemovalReadinessFacts {
  const lockInFlight = ctx.latestSubmission
    ? isLockedInFlight(ctx.latestSubmission)
    : false;
  return {
    local: ctx.latestSubmission?.status ?? null,
    lockInFlight,
    hasOrgCredentials: ctx.hasOrgCredentials,
    hasMapping: !!ctx.mapping,
    hasDefaultTemplate: !!ctx.defaultTemplate,
    missingDefaultTemplateId: ctx.missingDefaultTemplateId,
    unresolvedBlueprintKeys: ctx.unresolvedBlueprintKeys,
    hasSubmittableRuns: ctx.hasSubmittableRuns,
    productionReadinessGap: ctx.productionReadinessGap ?? null,
    entityReadinessGaps: ctx.entityReadinessGaps ?? [],
    durabilityGateBlockers: ctx.durabilityGateBlockers ?? [],
    futureDatedMeasurements: ctx.futureDatedMeasurements ?? [],
    supportingDocumentCount: ctx.supportingDocuments.total,
    mirroredDocumentCount: ctx.supportingDocuments.mirrored,
    requiredTransport: ctx.requiredTransportCategories.map((category) => {
      const bucket = ctx.transportCoverage[category];
      return {
        category,
        count: bucket.count,
        hasAggregationWarning: bucket.aggregationWarning !== null,
      };
    }),
  };
}
