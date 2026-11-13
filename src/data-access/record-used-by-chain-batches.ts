import { and, eq, gt, inArray, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { binMovements, creditBatchApplications, creditBatchProductionRuns, creditBatches, outputStockAllocations, outputStockRunAllocations, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordUsedByBatch, RecordUsedByNode } from "@/lib/record-used-by-chain";
import { activeOutputMovement, deletedProductIds } from "./output-stock-active-movements";
import { requireOrgScope } from "./utils";

/**
 * The root record's cohorts, never inferred from dates or legacy product links.
 * A reached Removal can contain other cohorts; those do not belong to this root.
 */
export async function readUsedByBatches(ctx: OrgContext, self: RecordUsedByNode, upstream: RecordUsedByNode[], downstream: RecordUsedByNode[]): Promise<RecordUsedByBatch[]> {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  const idsOf = (nodes: RecordUsedByNode[], kind: RecordUsedByNode["kind"]) => [...new Set(nodes.filter(node => node.kind === kind).map(node => node.id))];
  const batchIds = new Set(self.kind === "creditBatch" ? [self.id] : []);
  const runIds = new Set(self.kind === "productionRun" ? [self.id]
    : self.kind === "feedstock" ? idsOf(downstream, "productionRun")
    : self.kind === "biocharProduct" ? idsOf(upstream, "productionRun") : []);
  const deliveryIds = self.kind === "delivery" ? [self.id] : self.kind === "order" ? idsOf(downstream, "delivery") : [];
  if (deliveryIds.length) {
    const rows = await db.select({ id: outputStockRunAllocations.productionRunId }).from(outputStockRunAllocations)
      .innerJoin(outputStockAllocations, and(eq(outputStockAllocations.organizationId, org), eq(outputStockAllocations.id, outputStockRunAllocations.allocationId)))
      .innerJoin(binMovements, and(eq(binMovements.organizationId, org), eq(binMovements.id, outputStockAllocations.movementId)))
      .where(and(eq(outputStockRunAllocations.organizationId, org), inArray(outputStockAllocations.deliveryId, deliveryIds), activeOutputMovement(ctx, db),
        sql`(${outputStockAllocations.biocharProductId} is null or ${notInArray(outputStockAllocations.biocharProductId, deletedProductIds(ctx, db))})`))
      .groupBy(outputStockRunAllocations.productionRunId)
      .having(gt(sql`sum(${outputStockRunAllocations.dryMassKg})`, 0));
    for (const row of rows) runIds.add(row.id);
  }
  if (runIds.size) {
    const rows = await db.selectDistinct({ id: creditBatchProductionRuns.creditBatchId }).from(creditBatchProductionRuns)
      .where(and(eq(creditBatchProductionRuns.organizationId, org), inArray(creditBatchProductionRuns.productionRunId, [...runIds])));
    for (const row of rows) batchIds.add(row.id);
  }
  const sampleIds = self.kind === "sample" ? [self.id] : [];
  if (sampleIds.length) {
    const rows = await db.selectDistinct({ id: samples.creditBatchId }).from(samples)
      .where(and(eq(samples.organizationId, org), inArray(samples.id, sampleIds)));
    for (const row of rows) batchIds.add(row.id);
  }
  const applicationIds = self.kind === "application" ? [self.id] : [];
  const removalIds = self.kind === "removal" ? [self.id] : [];
  if (applicationIds.length || removalIds.length) {
    const rows = await db.selectDistinct({ id: creditBatchApplications.creditBatchId }).from(creditBatchApplications)
      .where(and(eq(creditBatchApplications.organizationId, org), or(
        inArray(creditBatchApplications.applicationId, applicationIds), inArray(creditBatchApplications.removalId, removalIds),
      )));
    for (const row of rows) batchIds.add(row.id);
  }
  if (!batchIds.size) return [];
  const rows = await db.select({ id: creditBatches.id, code: creditBatches.code, name: creditBatches.name, facilityId: creditBatches.facilityId,
    startDate: creditBatches.startDate, endDate: creditBatches.endDate })
    .from(creditBatches).where(and(eq(creditBatches.organizationId, org), inArray(creditBatches.id, [...batchIds])));
  return rows.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
}
