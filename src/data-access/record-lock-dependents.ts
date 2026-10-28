import { activeOutputMovement, deletedProductIds, liveOutputMovementPredicate } from "./output-stock-active-movements";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applications, biocharProductSourceAllocations, creditBatchApplications, creditBatchProductionRuns, deliveries, outputStockAllocations, productionRunFeedstocks, samples, outputStockRunAllocations, binMovements, productionRuns, biocharProducts } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordLockHolder } from "@/lib/record-lock";
import type { CertifiedLineageEntityType, CertifiedLineageTarget } from "./certification-lineage-guards";
import { isCountMovement } from "./output-stock-count";
import { requireOrgScope } from "./utils";

type Reader = Pick<DbTransaction, "select">;

/** Numeric consumers only. Merely sharing a bin does not establish a dependency. */
export async function readRecordDependents(ctx: OrgContext, tx: Reader, target: CertifiedLineageTarget): Promise<RecordLockHolder[]> {
  requireOrgScope(ctx);
  return (await readRecordDependentsBatch(ctx, tx, target.entityType, [target.entityId])).get(target.entityId) ?? [];
}

/**
 * `readRecordDependents` for many records of one kind in a fixed number of
 * set-based queries (one list page is one read, never one per record).
 * Each record's holders keep the single-record order.
 */
export async function readRecordDependentsBatch(
  ctx: OrgContext, tx: Reader, entityType: CertifiedLineageEntityType, ids: readonly string[],
): Promise<Map<string, RecordLockHolder[]>> {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  const wanted = [...new Set(ids)];
  const result = new Map<string, RecordLockHolder[]>(wanted.map(id => [id, []]));
  if (!wanted.length) return result;
  const push = (id: string, holder: RecordLockHolder) => result.get(id)?.push(holder);
  switch (entityType) {
    case "feedstock": {
      const rows = await tx.select({ feedstockId: productionRunFeedstocks.feedstockId, id: productionRunFeedstocks.productionRunId }).from(productionRunFeedstocks)
        .where(and(eq(productionRunFeedstocks.organizationId, org), inArray(productionRunFeedstocks.feedstockId, wanted)));
      for (const row of rows) push(row.feedstockId, { kind: "productionRun", id: row.id });
      return result;
    }
    case "productionRun": {
      const [products, batches, effects, runs] = await Promise.all([
        tx.select({ runId: biocharProductSourceAllocations.productionRunId, id: biocharProductSourceAllocations.biocharProductId }).from(biocharProductSourceAllocations)
          .where(and(eq(biocharProductSourceAllocations.organizationId, org), inArray(biocharProductSourceAllocations.productionRunId, wanted),
            notInArray(biocharProductSourceAllocations.biocharProductId, deletedProductIds(ctx, tx)))),
        tx.select({ runId: creditBatchProductionRuns.productionRunId, id: creditBatchProductionRuns.creditBatchId }).from(creditBatchProductionRuns)
          .where(and(eq(creditBatchProductionRuns.organizationId, org), inArray(creditBatchProductionRuns.productionRunId, wanted))),
        tx.select({ runId: outputStockRunAllocations.productionRunId, id: outputStockAllocations.movementId }).from(outputStockRunAllocations)
          .innerJoin(outputStockAllocations, and(eq(outputStockAllocations.organizationId, org), eq(outputStockAllocations.id, outputStockRunAllocations.allocationId)))
          .innerJoin(binMovements, and(eq(binMovements.organizationId, org), eq(binMovements.id, outputStockAllocations.movementId)))
          .where(and(eq(outputStockRunAllocations.organizationId, org), inArray(outputStockRunAllocations.productionRunId, wanted), activeOutputMovement(ctx, tx))),
        tx.select().from(productionRuns).where(and(eq(productionRuns.organizationId, org), inArray(productionRuns.id, wanted))),
      ]);
      const binIds = [...new Set(runs.flatMap(run => run.biocharStorageLocationId ? [run.biocharStorageLocationId] : []))];
      const movements = binIds.length === 0 ? [] : await tx.select().from(binMovements)
        .where(and(eq(binMovements.organizationId, org), inArray(binMovements.storageLocationId, binIds)));
      for (const row of products) push(row.runId, { kind: "biocharProduct", id: row.id });
      for (const row of batches) push(row.runId, { kind: "creditBatch", id: row.id });
      for (const row of effects) push(row.runId, { kind: "stockEntry", id: row.id });
      for (const run of runs) {
        if (!run.biocharStorageLocationId) continue;
        const counts = movements.filter(movement => movement.storageLocationId === run.biocharStorageLocationId &&
          isCountMovement(movement) && run.createdAt <= movement.createdAt &&
          (!run.endTime || (movement.occurredAt && run.endTime <= movement.occurredAt)));
        for (const movement of counts) push(run.id, { kind: "stockEntry", id: movement.id });
      }
      return result;
    }
    case "biocharProduct": {
      const [rows, products] = await Promise.all([
        tx.select({ productId: outputStockAllocations.biocharProductId, id: outputStockAllocations.movementId }).from(outputStockAllocations)
          .innerJoin(binMovements, and(eq(binMovements.organizationId, org), eq(binMovements.id, outputStockAllocations.movementId)))
          .where(and(eq(outputStockAllocations.organizationId, org), inArray(outputStockAllocations.biocharProductId, wanted), activeOutputMovement(ctx, tx))),
        tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, org), inArray(biocharProducts.id, wanted))),
      ]);
      const binIds = [...new Set(products.flatMap(product => product.storageLocationId ? [product.storageLocationId] : []))];
      const movements = binIds.length === 0 ? [] : await tx.select().from(binMovements)
        .where(and(eq(binMovements.organizationId, org), inArray(binMovements.storageLocationId, binIds)));
      for (const row of rows) if (row.productId) push(row.productId, { kind: "stockEntry", id: row.id });
      for (const product of products) {
        if (!product.storageLocationId) continue;
        const binMovementsOfProduct = movements.filter(movement => movement.storageLocationId === product.storageLocationId);
        const counts = binMovementsOfProduct.filter(liveOutputMovementPredicate(binMovementsOfProduct)).filter(movement =>
          isCountMovement(movement) && product.createdAt <= movement.createdAt && movement.occurredAt && product.placedAt <= movement.occurredAt);
        for (const movement of counts) push(product.id, { kind: "stockEntry", id: movement.id });
      }
      return result;
    }
    case "order": {
      const rows = await tx.select({ orderId: deliveries.orderId, id: deliveries.id, label: deliveries.code }).from(deliveries)
        .where(and(eq(deliveries.organizationId, org), inArray(deliveries.orderId, wanted)));
      for (const row of rows) push(row.orderId, { kind: "delivery", id: row.id, label: row.label });
      return result;
    }
    case "delivery": {
      const rows = await tx.select({ deliveryId: applications.deliveryId, id: applications.id, label: applications.code }).from(applications)
        .where(and(eq(applications.organizationId, org), inArray(applications.deliveryId, wanted)));
      for (const row of rows) if (row.deliveryId) push(row.deliveryId, { kind: "application", id: row.id, label: row.label });
      return result;
    }
    case "application": {
      const rows = await tx.select({ applicationId: creditBatchApplications.applicationId, id: creditBatchApplications.removalId }).from(creditBatchApplications)
        .where(and(eq(creditBatchApplications.organizationId, org), inArray(creditBatchApplications.applicationId, wanted), isNotNull(creditBatchApplications.removalId)));
      for (const row of rows) push(row.applicationId, { kind: "removal", id: row.id! });
      return result;
    }
    case "sample": {
      const rows = await tx.select({ sampleId: samples.id, id: creditBatchApplications.removalId }).from(samples)
        .innerJoin(creditBatchApplications, and(eq(creditBatchApplications.creditBatchId, samples.creditBatchId), eq(creditBatchApplications.organizationId, org)))
        .where(and(eq(samples.organizationId, org), inArray(samples.id, wanted), isNotNull(creditBatchApplications.removalId)));
      for (const row of rows) push(row.sampleId, { kind: "removal", id: row.id! });
      return result;
    }
    case "creditBatch": {
      const [slices, batchSamples] = await Promise.all([
        tx.select({ batchId: creditBatchApplications.creditBatchId, id: creditBatchApplications.removalId }).from(creditBatchApplications)
          .where(and(eq(creditBatchApplications.organizationId, org), inArray(creditBatchApplications.creditBatchId, wanted), isNotNull(creditBatchApplications.removalId))),
        tx.select({ batchId: samples.creditBatchId, id: samples.id }).from(samples)
          .where(and(eq(samples.organizationId, org), inArray(samples.creditBatchId, wanted))),
      ]);
      for (const row of slices) push(row.batchId, { kind: "removal", id: row.id! });
      for (const row of batchSamples) push(row.batchId, { kind: "sample", id: row.id });
      return result;
    }
  }
}
