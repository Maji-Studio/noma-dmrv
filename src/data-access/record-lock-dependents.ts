import { and, eq, isNotNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applications, biocharProductSourceAllocations, creditBatchApplications, creditBatchProductionRuns, deliveries, outputStockAllocations, productionRunFeedstocks, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordLockHolder } from "@/lib/record-lock";
import type { CertifiedLineageTarget } from "./certification-lineage-guards";
import { requireOrgScope } from "./utils";

/** Numeric consumers only. Merely sharing a bin does not establish a dependency. */
export async function readRecordDependents(ctx: OrgContext, tx: DbTransaction, target: CertifiedLineageTarget): Promise<RecordLockHolder[]> {
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
        .where(and(eq(biocharProductSourceAllocations.organizationId, ctx.organizationId), eq(biocharProductSourceAllocations.productionRunId, id)));
      const batches = await tx.select({ id: creditBatchProductionRuns.creditBatchId }).from(creditBatchProductionRuns)
        .where(and(eq(creditBatchProductionRuns.organizationId, ctx.organizationId), eq(creditBatchProductionRuns.productionRunId, id)));
      return [...rows.map(row => ({ kind: "biocharProduct", id: row.id })), ...batches.map(row => ({ kind: "creditBatch", id: row.id }))];
    }
    case "biocharProduct": {
      const rows = await tx.select({ id: outputStockAllocations.movementId }).from(outputStockAllocations)
        .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.biocharProductId, id)));
      return rows.map(row => ({ kind: "stockEntry", id: row.id }));
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
      const rows = await tx.select({ id: creditBatchApplications.removalId }).from(creditBatchApplications)
        .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.creditBatchId, id), isNotNull(creditBatchApplications.removalId)));
      return rows.map(row => ({ kind: "removal", id: row.id! }));
    }
  }
}
