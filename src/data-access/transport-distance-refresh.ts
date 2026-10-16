import { and, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { deliveries, feedstocks } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { DomainError } from "@/lib/domain-errors";
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";
import { formatCertificationLineageLockMessage } from "@/lib/certification/lineage-lock-message";
import type { RefreshTransportDistanceInput, TransportDistanceTarget } from "@/schemas/transport-distance-refresh";
import { assertCanMutateCertifiedLineage, lockCertifiedLineageArtifacts, assertLockedLineagesAllowMutation } from "./certification-lineage-guards";
import { distanceRefreshLineageTargets, getTransportDistanceDrift } from "./transport-distance-drift";
import { assertRowVersion, nextVersion } from "./row-version";
import { lockBiocharTransportRouteTopology, syncBiocharProductTransportLegs, syncFeedstockTransportLeg } from "./transport-legs";
import { requireOrgScope } from "./utils";

export { getTransportDistanceDrift } from "./transport-distance-drift";

const LOCKED_REFRESH_MESSAGE = "The distance was not refreshed because its transport data belongs to a locked Removal. Ask an Organization Admin to review the linked Removal.";

async function guardRefresh(ctx: OrgContext, tx: DbTransaction, target: TransportDistanceTarget) {
  requireOrgScope(ctx);
  const targets = await distanceRefreshLineageTargets(ctx, tx, target);
  const lockedKeys = await lockCertifiedLineageArtifacts(ctx, tx, targets);
  for (const lineageTarget of targets) {
    try {
      await withFeedstockErrors(() => assertCanMutateCertifiedLineage(ctx, tx, lineageTarget, "update"), "certification_locked");
    } catch (error) {
      if (error instanceof SafeError && error.message === formatCertificationLineageLockMessage({
        mutation: "update", subjectEntityType: lineageTarget.entityType, lineageEntityType: lineageTarget.entityType,
      })) throw new DomainError("certification_locked", LOCKED_REFRESH_MESSAGE);
      throw error;
    }
  }
  return { targets, lockedKeys };
}

export async function refreshFeedstockDistanceInTransaction(ctx: OrgContext, tx: DbTransaction, input: RefreshTransportDistanceInput) {
  requireOrgScope(ctx);
  const target = { entityType: "feedstock" as const, entityId: input.entityId };
  await lockBiocharTransportRouteTopology(ctx, tx);
  // Intake writers lock the feedstock before certification artifacts.
  const [row] = await tx.select().from(feedstocks).where(and(eq(feedstocks.organizationId, ctx.organizationId),
    eq(feedstocks.id, input.entityId), isNull(feedstocks.archivedAt))).for("update");
  if (!row) throw new DomainError("not_found", "Feedstock not found or archived.");
  assertRowVersion({ entity: "feedstock", id: row.id, expectedVersion: input.expectedVersion, actualVersion: row.version });
  await guardRefresh(ctx, tx, target);
  if (row.distanceKmOverride != null && row.distanceKmOverride > 0) throw new DomainError("validation_failed", "The distance was not refreshed because it has an override. Clear the override first.");
  await syncFeedstockTransportLeg(ctx, tx, row.id, { refreshFromLocation: true, requireLocationDistance: true });
  await tx.update(feedstocks).set({ version: nextVersion(feedstocks.version), updatedAt: new Date() })
    .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.id, row.id)));
  return getTransportDistanceDrift(ctx, target, tx);
}

export async function refreshDeliveryDistanceInTransaction(ctx: OrgContext, tx: DbTransaction, input: RefreshTransportDistanceInput) {
  requireOrgScope(ctx);
  const target = { entityType: "delivery" as const, entityId: input.entityId };
  await lockBiocharTransportRouteTopology(ctx, tx);
  const { targets, lockedKeys } = await guardRefresh(ctx, tx, target);
  const [row] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId),
    eq(deliveries.id, input.entityId), isNull(deliveries.archivedAt))).for("update");
  if (!row) throw new DomainError("not_found", "Delivery not found or archived.");
  assertRowVersion({ entity: "delivery", id: row.id, expectedVersion: input.expectedVersion, actualVersion: row.version });
  await withFeedstockErrors(() => assertLockedLineagesAllowMutation(ctx, tx, lockedKeys, targets.map(lineageTarget => ({ target: lineageTarget, mutation: "update" }))), "certification_locked");
  if (row.distanceKmOverride != null && row.distanceKmOverride > 0) throw new DomainError("validation_failed", "The distance was not refreshed because it has an override. Clear the override first.");
  const preview = await getTransportDistanceDrift(ctx, target, tx);
  if (preview.currentDistanceKm == null) throw new DomainError("validation_failed", "The distance was not refreshed because the location has no distance for this facility. Save a location distance first.");
  await tx.update(deliveries).set({ recordedDistanceKm: preview.currentDistanceKm, recordedDistanceSource: preview.currentDistanceSource, distanceSource: null,
    version: nextVersion(deliveries.version), updatedAt: new Date() })
    .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, row.id)));
  await syncBiocharProductTransportLegs(ctx, tx, targets.filter(item => item.entityType === "biocharProduct").map(item => item.entityId));
  return getTransportDistanceDrift(ctx, target, tx);
}
