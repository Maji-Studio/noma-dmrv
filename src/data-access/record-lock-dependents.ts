import { activeOutputMovement, deletedProductIds, liveOutputMovementPredicate } from './output-stock-active-movements';
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applications, biocharProductSourceAllocations, creditBatchApplications, creditBatchProductionRuns, deliveries, outputStockAllocations, productionRunFeedstocks, samples, outputStockRunAllocations, binMovements, productionRuns, biocharProducts } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordLockHolder } from "@/lib/record-lock";
import type { CertifiedLineageTarget } from "./certification-lineage-guards";
import { isCountMovement } from "./output-stock-count";
import { requireOrgScope } from "./utils";

/** Numeric consumers only. Merely sharing a bin does not establish a dependency. */
export async function readRecordDependents(ctx: OrgContext, tx: Pick<DbTransaction, "select">, target: CertifiedLineageTarget): Promise<RecordLockHolder[]> {
  requireOrgScope(ctx);
  const id = target.entityId;
  switch (target.entityType) {
    case "feedstock": {
      const rows = await tx.select({ id: productionRunFeedstocks.productionRunId }).from(productionRunFeedstocks)
        .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), eq(productionRunFeedstocks.feedstockId, id)));
      return rows.map(row => ({ kind: "productionRun", id: row.id }));
    }
    case "productionRun": {
      const rows = await tx.select({ id: biocharProductSourceAllocations.biocharProductId }).from(biocharProductSourceAllocations)
        .where(and(eq(biocharProductSourceAllocations.organizationId, ctx.organizationId), eq(biocharProductSourceAllocations.productionRunId, id), notInArray(biocharProductSourceAllocations.biocharProductId, deletedProductIds(ctx, tx))));
      const batches = await tx.select({ id: creditBatchProductionRuns.creditBatchId }).from(creditBatchProductionRuns)
        .where(and(eq(creditBatchProductionRuns.organizationId, ctx.organizationId), eq(creditBatchProductionRuns.productionRunId, id)));
      const effects = await tx.select({ id: outputStockAllocations.movementId }).from(outputStockRunAllocations)
        .innerJoin(outputStockAllocations, and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.id, outputStockRunAllocations.allocationId)))
        .innerJoin(binMovements, and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.id, outputStockAllocations.movementId)))
        .where(and(eq(outputStockRunAllocations.organizationId, ctx.organizationId), eq(outputStockRunAllocations.productionRunId, id), activeOutputMovement(ctx, tx)));
      const [run] = await tx.select().from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, id)));
      const movements = !run?.biocharStorageLocationId ? [] : await tx.select().from(binMovements)
        .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, run.biocharStorageLocationId)));
      const counts = movements.filter(movement => isCountMovement(movement) && run!.createdAt <= movement.createdAt &&
        (!run!.endTime || (movement.occurredAt && run!.endTime <= movement.occurredAt)));
      return [...rows.map(row => ({ kind: "biocharProduct", id: row.id })), ...batches.map(row => ({ kind: "creditBatch", id: row.id })),
        ...effects.map(row => ({ kind: "stockEntry", id: row.id })), ...counts.map(row => ({ kind: "stockEntry", id: row.id }))];
    }
    case "biocharProduct": {
      const rows = await tx.select({ id: outputStockAllocations.movementId }).from(outputStockAllocations)
        .innerJoin(binMovements, and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.id, outputStockAllocations.movementId)))
        .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.biocharProductId, id), activeOutputMovement(ctx, tx)));
      const [product] = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, id)));
      const movements = !product?.storageLocationId ? [] : await tx.select().from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.storageLocationId, product.storageLocationId)));
      const counts = movements.filter(liveOutputMovementPredicate(movements)).filter(movement => isCountMovement(movement) && product!.createdAt <= movement.createdAt && movement.occurredAt && product!.placedAt <= movement.occurredAt);
      return [...rows.map(row => ({ kind: "stockEntry", id: row.id })), ...counts.map(row => ({ kind: "stockEntry", id: row.id }))];
    }
    case "order": {
      const rows = await tx.select({ id: deliveries.id, label: deliveries.code }).from(deliveries)
        .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.orderId, id)));
      return rows.map(row => ({ kind: "delivery", ...row }));
    }
    case "delivery": {
      const rows = await tx.select({ id: applications.id, label: applications.code }).from(applications)
        .where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.deliveryId, id)));
      return rows.map(row => ({ kind: "application", ...row }));
    }
    case "application": {
      const rows = await tx.select({ id: creditBatchApplications.removalId }).from(creditBatchApplications)
        .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.applicationId, id), isNotNull(creditBatchApplications.removalId)));
      return rows.map(row => ({ kind: "removal", id: row.id! }));
    }
    case "sample": {
      const rows = await tx.select({ id: creditBatchApplications.removalId }).from(samples)
        .innerJoin(creditBatchApplications, and(eq(creditBatchApplications.creditBatchId, samples.creditBatchId), eq(creditBatchApplications.organizationId, ctx.organizationId)))
        .where(and(eq(samples.organizationId, ctx.organizationId), eq(samples.id, id), isNotNull(creditBatchApplications.removalId)));
      return rows.map(row => ({ kind: "removal", id: row.id! }));
    }
    case "creditBatch": {
      const batchSamples = await tx.select({ id: samples.id }).from(samples)
        .where(and(eq(samples.organizationId, ctx.organizationId), eq(samples.creditBatchId, id)));
      const rows = await tx.select({ id: creditBatchApplications.removalId }).from(creditBatchApplications)
        .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.creditBatchId, id), isNotNull(creditBatchApplications.removalId)));
      return [...rows.map(row => ({ kind: "removal", id: row.id! })), ...batchSamples.map(row => ({ kind: "sample", id: row.id }))];
    }
  }
}
