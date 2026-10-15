import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applicationOutputAllocations, biocharProductSourceAllocations, creditBatchProductionRuns, deliveries, incidentReports, outputStockAllocations, outputStockRunAllocations, productionRunFeedstocks, productionSamples, samples, transportLegs } from "@/db/schema";
import { DOCUMENT_ENTITY_TYPES } from "@/schemas/documents";
import type { OrgContext } from "@/lib/auth/server";
import { toActivityEntityType } from "@/lib/activity-entity-type";
import { recordActivity, type ActivityEventInput } from "./activity-events";
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
    const rows = await tx.selectDistinct({ id: outputStockRunAllocations.productionRunId }).from(outputStockRunAllocations)
      .innerJoin(outputStockAllocations, and(eq(outputStockAllocations.id, outputStockRunAllocations.allocationId), eq(outputStockAllocations.organizationId, ctx.organizationId)))
      .innerJoin(deliveries, and(eq(deliveries.id, outputStockAllocations.deliveryId), eq(deliveries.organizationId, ctx.organizationId)))
      .where(and(eq(outputStockRunAllocations.organizationId, ctx.organizationId), entityType === "delivery" ? eq(deliveries.id, entityId) : eq(deliveries.orderId, entityId)));
    runIds = rows.map(row => row.id);
  } else if (entityType === "application") {
    const rows = await tx.selectDistinct({ id: applicationOutputAllocations.productionRunId }).from(applicationOutputAllocations)
      .where(and(eq(applicationOutputAllocations.applicationId, entityId), eq(applicationOutputAllocations.organizationId, ctx.organizationId)));
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
  for (const scope of scopes) await recordActivity(ctx, tx, { ...event, ...scope });
}

export async function recordMembershipActivity(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
  previousRunIds: readonly string[],
  nextRunIds: readonly string[],
  options: { source?: "form" | "system"; changedFields?: string[]; recordBatchEvent?: boolean } = {},
): Promise<boolean> {
  requireOrgScope(ctx);
  const source = options.source ?? "form";
  const actorUserId = source === "system" ? null : ctx.userId;
  const previous = new Set(previousRunIds);
  const next = new Set(nextRunIds);
  const changed = [...new Set([...previous, ...next])].filter(id => previous.has(id) !== next.has(id));
  if (changed.length === 0) return false;
  // Batch create/delete already records its lifecycle; edits record membership here.
  if (options.recordBatchEvent !== false) for (const productionRunId of changed) await recordActivity(ctx, tx, {
    entityType: "credit_batch", entityId: creditBatchId, creditBatchId, productionRunId,
    action: "updated", changedFields: ["production_runs", ...(options.changedFields ?? [])], source, actorUserId,
  });
  for (const productionRunId of changed) await recordActivity(ctx, tx, {
    entityType: toActivityEntityType("productionRun"), entityId: productionRunId, productionRunId, creditBatchId,
    action: "updated", changedFields: ["credit_batch"], source, actorUserId,
    reasonCode: next.has(productionRunId) ? "attached" : "detached",
  });
  return true;
}

/** Preserve the owner UUID and controlled type keys, never file details. */
export async function recordDocumentActivity(
  ctx: OrgContext, tx: DbTransaction,
  document: { id: string; documentType: string; entityType: string; entityId: string },
  action: "created" | "deleted", scopes?: ActivityScope[],
  source: ActivityEventInput["source"] = "form",
): Promise<void> {
  requireOrgScope(ctx);
  const ownerType = DOCUMENT_ENTITY_TYPES.find(type => type === document.entityType)
    ?? (document.entityType === "ghgStatement" ? "ghg_statement"
      : document.entityType === "ghgStatementReport" ? "ghg_statement_report" : "other");
  const resolvedScopes = scopes ?? await resolveWriteActivityScopes(ctx, tx, document.entityType, document.entityId);
  await recordScopedWriteActivity(ctx, tx, {
    entityType: "document", entityId: document.id, action, source,
    reasonCode: `document:${document.documentType}:${ownerType}:${document.entityId}`,
  }, resolvedScopes);
}
