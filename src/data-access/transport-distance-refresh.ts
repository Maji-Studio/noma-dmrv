import { and, eq, isNull } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { deliveries, feedstocks } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { formatCertificationLineageLockMessage } from "@/lib/certification/lineage-lock-message";
import type { RefreshTransportDistanceInput, TransportDistanceTarget } from "@/schemas/transport-distance-refresh";
import { assertCanMutateCertifiedLineage, lockCertifiedLineageArtifacts, assertLockedLineagesAllowMutation } from "./certification-lineage-guards";
import { distanceRefreshLineageTargets, getTransportDistanceDrift } from "./transport-distance-drift";
import { assertRowVersion, nextVersion } from "./row-version";
import { lockBiocharTransportRouteTopology, syncBiocharProductTransportLegs, syncFeedstockTransportLeg } from "./transport-legs";
import { requireOrgScope } from "./utils";
import { recordScopedWriteActivity, resolveWriteActivityScopes } from "./write-activity";
import { processPendingStorageObjectDeletions } from "./storage-object-deletions";

export { getTransportDistanceDrift } from "./transport-distance-drift";

const LOCKED_REFRESH_MESSAGE = "The distance was not refreshed because its transport data belongs to a locked Removal. Ask an Organization Admin to review the linked Removal.";

async function guardRefresh(ctx: OrgContext, tx: DbTransaction, target: TransportDistanceTarget) {
  requireOrgScope(ctx);
  const targets = await distanceRefreshLineageTargets(ctx, tx, target);
  const lockedKeys = await lockCertifiedLineageArtifacts(ctx, tx, targets);
  for (const lineageTarget of targets) {
    try {
      await assertCanMutateCertifiedLineage(ctx, tx, lineageTarget, "update");
    } catch (error) {
      if (error instanceof SafeError && error.message === formatCertificationLineageLockMessage({
        mutation: "update", subjectEntityType: lineageTarget.entityType, lineageEntityType: lineageTarget.entityType,
      })) throw new SafeError(LOCKED_REFRESH_MESSAGE);
      throw error;
    }
  }
  return { targets, lockedKeys };
}

async function recordRefresh(ctx: OrgContext, tx: DbTransaction, target: TransportDistanceTarget, facilityId: string, version: number) {
  requireOrgScope(ctx);
  await recordScopedWriteActivity(ctx, tx, {
    entityType: target.entityType, entityId: target.entityId, facilityId, action: "updated", source: "form",
    changedFields: ["recordedDistanceKm", "recordedDistanceSource"], versionBefore: version, versionAfter: version + 1,
  }, await resolveWriteActivityScopes(ctx, tx, target.entityType, target.entityId));
}

export async function refreshFeedstockDistance(ctx: OrgContext, input: RefreshTransportDistanceInput) {
  requireOrgScope(ctx);
  const target = { entityType: "feedstock" as const, entityId: input.entityId };
  const result = await db.transaction(async tx => {
    await lockBiocharTransportRouteTopology(ctx, tx);
    // Intake writers lock the feedstock before certification artifacts.
    const [row] = await tx.select().from(feedstocks).where(and(eq(feedstocks.organizationId, ctx.organizationId),
      eq(feedstocks.id, input.entityId), isNull(feedstocks.archivedAt))).for("update");
    if (!row) throw new SafeError("Feedstock not found or archived.");
    assertRowVersion({ entity: "feedstock", id: row.id, expectedVersion: input.expectedVersion, actualVersion: row.version });
    await guardRefresh(ctx, tx, target);
    if (row.distanceKmOverride != null) throw new SafeError("The distance was not refreshed because it has an override. Clear the override first.");
    const preview = await getTransportDistanceDrift(ctx, target, tx);
    if (preview.currentDistanceKm == null) throw new SafeError("The distance was not refreshed because the location has no distance for this facility. Save a location distance first.");
    await tx.update(feedstocks).set({ version: nextVersion(feedstocks.version), updatedAt: new Date() })
      .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.id, row.id)));
    await syncFeedstockTransportLeg(ctx, tx, row.id, { refreshFromLocation: true });
    await recordRefresh(ctx, tx, target, row.facilityId, row.version);
    return getTransportDistanceDrift(ctx, target, tx);
  });
  await processPendingStorageObjectDeletions(ctx);
  return result;
}

export async function refreshDeliveryDistance(ctx: OrgContext, input: RefreshTransportDistanceInput) {
  requireOrgScope(ctx);
  const target = { entityType: "delivery" as const, entityId: input.entityId };
  const result = await db.transaction(async tx => {
    await lockBiocharTransportRouteTopology(ctx, tx);
    const { targets, lockedKeys } = await guardRefresh(ctx, tx, target);
    const [row] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId),
      eq(deliveries.id, input.entityId), isNull(deliveries.archivedAt))).for("update");
    if (!row) throw new SafeError("Delivery not found or archived.");
    assertRowVersion({ entity: "delivery", id: row.id, expectedVersion: input.expectedVersion, actualVersion: row.version });
    await assertLockedLineagesAllowMutation(ctx, tx, lockedKeys, targets.map(lineageTarget => ({ target: lineageTarget, mutation: "update" })));
    if (row.distanceKmOverride != null) throw new SafeError("The distance was not refreshed because it has an override. Clear the override first.");
    const preview = await getTransportDistanceDrift(ctx, target, tx);
    if (preview.currentDistanceKm == null) throw new SafeError("The distance was not refreshed because the location has no distance for this facility. Save a location distance first.");
    await tx.update(deliveries).set({ recordedDistanceKm: preview.currentDistanceKm, recordedDistanceSource: preview.currentDistanceSource,
      version: nextVersion(deliveries.version), updatedAt: new Date() })
      .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, row.id)));
    await syncBiocharProductTransportLegs(ctx, tx, targets.filter(item => item.entityType === "biocharProduct").map(item => item.entityId));
    await recordRefresh(ctx, tx, target, row.facilityId, row.version);
    return getTransportDistanceDrift(ctx, target, tx);
  });
  await processPendingStorageObjectDeletions(ctx);
  return result;
}
