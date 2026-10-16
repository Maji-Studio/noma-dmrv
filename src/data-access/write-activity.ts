import type { ActivitySnapshot } from "@/lib/activity-changes";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applicationOutputAllocations, biocharProductSourceAllocations, creditBatchProductionRuns, deliveries, incidentReports, productionRunFeedstocks, productionSamples, samples, transportLegs } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { documentActivityReasonCode, toActivityEntityType } from "@/lib/activity-entity-type";
import { SafeError } from "@/lib/errors";
import { deliveryProductAllocations, getDeliveryAllocationProvenance } from "./delivery-allocation-provenance";
import { recordActivity, recordActivityChange, type ActivityEventInput } from "./activity-events";
import { requireOrgScope } from "./utils";

export type ActivityScope = Pick<ActivityEventInput, "creditBatchId" | "productionRunId">;

/** Resolve ownership before deleting parents or their allocation links. */
export async function resolveWriteActivityScopes(
  ctx: OrgContext, tx: DbTransaction, entityType: string, entityId: string,
): Promise<ActivityScope[]> {
  requireOrgScope(ctx);
  if (entityType === "credit_batch") return [{ creditBatchId: entityId }];
  if (entityType === "sample") {
    const [sample] = await tx.select({ creditBatchId: samples.creditBatchId, productionRunId: samples.productionRunId })
      .from(samples).where(and(eq(samples.id, entityId), eq(samples.organizationId, ctx.organizationId)));
    return sample ? [sample] : [{}];
  }
  if (entityType === "transport_leg") {
    const [leg] = await tx.select({ entityType: transportLegs.entityType, entityId: transportLegs.entityId })
      .from(transportLegs).where(and(eq(transportLegs.id, entityId), eq(transportLegs.organizationId, ctx.organizationId)));
    return leg ? resolveWriteActivityScopes(ctx, tx, leg.entityType, leg.entityId) : [{}];
  }
  if (entityType === "production_incident" || entityType === "production_sample") {
    const table = entityType === "production_incident" ? incidentReports : productionSamples;
    const [row] = await tx.select({ productionRunId: table.productionRunId }).from(table)
      .where(and(eq(table.id, entityId), eq(table.organizationId, ctx.organizationId)));
    return row ? resolveWriteActivityScopes(ctx, tx, "production_run", row.productionRunId) : [{}];
  }
  let runIds: string[];
  if (entityType === "production_run") {
    runIds = [entityId];
  } else if (entityType === "delivery" || entityType === "order") {
    const layers = deliveryProductAllocations(ctx, tx);
    const rows = await tx.selectDistinct({ id: deliveries.id }).from(layers)
      .innerJoin(deliveries, and(eq(deliveries.id, layers.deliveryId), eq(deliveries.organizationId, ctx.organizationId)))
      .where(and(eq(deliveries.organizationId, ctx.organizationId), entityType === "delivery" ? eq(deliveries.id, entityId) : eq(deliveries.orderId, entityId)));
    try {
      const shares = await getDeliveryAllocationProvenance(ctx, rows.map(row => row.id), tx);
      runIds = [...new Set(shares.filter(share => share.dryMassKg > 0 || share.wetMassKg > 0).map(share => share.productionRunId))];
    } catch (error) {
      // Activity links are best-effort; invalid saved provenance must not block writes.
      if (!(error instanceof SafeError)) throw error;
      return [{}];
    }
  } else if (entityType === "application") {
    const rows = await tx.selectDistinct({ id: applicationOutputAllocations.productionRunId }).from(applicationOutputAllocations)
      .where(and(eq(applicationOutputAllocations.applicationId, entityId), eq(applicationOutputAllocations.organizationId, ctx.organizationId),
        or(gt(applicationOutputAllocations.wetMassKg, "0"), gt(applicationOutputAllocations.dryMassKg, "0"))));
    runIds = rows.map(row => row.id);
  } else if (entityType === "biochar" || entityType === "biochar_product") {
    const rows = await tx.selectDistinct({ id: biocharProductSourceAllocations.productionRunId }).from(biocharProductSourceAllocations)
      .where(and(eq(biocharProductSourceAllocations.biocharProductId, entityId), eq(biocharProductSourceAllocations.organizationId, ctx.organizationId)));
    runIds = rows.map(row => row.id);
  } else if (entityType === "feedstock") {
    const rows = await tx.selectDistinct({ id: productionRunFeedstocks.productionRunId }).from(productionRunFeedstocks)
      .where(and(eq(productionRunFeedstocks.feedstockId, entityId), eq(productionRunFeedstocks.organizationId, ctx.organizationId)));
    runIds = rows.map(row => row.id);
  } else {
    return [{}];
  }
  if (runIds.length === 0) return [{}];
  const memberships = await tx.selectDistinct({ creditBatchId: creditBatchProductionRuns.creditBatchId }).from(creditBatchProductionRuns)
    .where(and(inArray(creditBatchProductionRuns.productionRunId, runIds), eq(creditBatchProductionRuns.organizationId, ctx.organizationId)));
  const productionRunId = runIds.length === 1 ? runIds[0] : null;
  return memberships.length ? memberships.map(row => ({ ...row, productionRunId })) : [{ productionRunId }];
}

/** One event per affected batch; a single event when the record has no batch. */
export async function recordScopedWriteActivity(
  ctx: OrgContext, tx: DbTransaction, event: ActivityEventInput, scopes: ActivityScope[],
): Promise<void> {
  requireOrgScope(ctx);
  for (const scope of scopes) await recordActivity(ctx, tx, { ...event, ...scope, entityType: toActivityEntityType(event.entityType) });
}

/** Scoped snapshot capture uses the same policy as the operation runner. */
export async function recordScopedActivityChange(
  ctx: OrgContext, tx: DbTransaction, event: Omit<ActivityEventInput, "changedFields" | "changes">,
  scopes: ActivityScope[], before: ActivitySnapshot | null, after: ActivitySnapshot | null,
  options: { skipEmpty?: boolean } = {},
): Promise<void> {
  requireOrgScope(ctx);
  for (const scope of scopes) await recordActivityChange(ctx, tx, { ...event, ...scope }, before, after, options);
}

export async function recordMembershipActivity(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
  previousRunIds: readonly string[],
  nextRunIds: readonly string[],
  options: { source?: ActivityEventInput["source"]; before?: ActivitySnapshot; after?: ActivitySnapshot; recordBatchEvent?: boolean } = {},
): Promise<boolean> {
  requireOrgScope(ctx);
  const source = options.source ?? "form";
  const previous = new Set(previousRunIds);
  const next = new Set(nextRunIds);
  const changed = [...new Set([...previous, ...next])].filter(id => previous.has(id) !== next.has(id));
  if (changed.length === 0) return false;
  // Batch create/delete already records its lifecycle; edits record membership here.
  if (options.recordBatchEvent !== false) for (const productionRunId of changed) await recordActivityChange(ctx, tx, {
    entityType: toActivityEntityType("credit_batch"), entityId: creditBatchId, creditBatchId, productionRunId,
    action: "updated", source,
  }, { ...options.before, production_runs: [...previous].sort() }, { ...options.after, production_runs: [...next].sort() });
  for (const productionRunId of changed) await recordActivityChange(ctx, tx, {
    entityType: toActivityEntityType("productionRun"), entityId: productionRunId, productionRunId, creditBatchId,
    action: "updated", source,
    reasonCode: next.has(productionRunId) ? "attached" : "detached",
  }, { credit_batch: previous.has(productionRunId) ? creditBatchId : null }, { credit_batch: next.has(productionRunId) ? creditBatchId : null });
  return true;
}

/** Preserve the owner UUID and controlled type keys, never file details. */
export async function recordDocumentActivity(
  ctx: OrgContext, tx: DbTransaction,
  document: { id: string; documentType: string; entityType: string; entityId: string },
  action: "created" | "deleted",
  options: { source: ActivityEventInput["source"]; scopes?: ActivityScope[]; actorUserId?: ActivityEventInput["actorUserId"] },
): Promise<void> {
  requireOrgScope(ctx);
  const { source, actorUserId, scopes } = options;
  const resolvedScopes = scopes ?? await resolveWriteActivityScopes(ctx, tx, document.entityType, document.entityId);
  await recordScopedWriteActivity(ctx, tx, {
    entityType: toActivityEntityType("document"), entityId: document.id, action, source, actorUserId,
    reasonCode: documentActivityReasonCode(document),
  }, resolvedScopes);
}
