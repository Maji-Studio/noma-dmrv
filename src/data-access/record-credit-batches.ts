import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applicationOutputAllocations, applications, biocharProducts,
  creditBatchApplications, creditBatchProductionRuns, creditBatches, deliveries,
  feedstocks, outputStockAllocations, outputStockRunAllocations,
  productionRunFeedstocks, productionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordCreditBatchesInput } from "@/schemas/record-credit-batches";
import type { RecordCreditBatch, RecordCreditBatches } from "@/types/record-credit-batches";
import { getMixBinHeldApplicationIds } from "./mix-bin-credit-hold";
import { assertSameOrg, requireOrgScope } from "./utils";

const batchSelection = {
  id: creditBatches.id,
  code: creditBatches.code,
  startDate: creditBatches.startDate,
  endDate: creditBatches.endDate,
};

/** Read saved provenance only; record dates never choose a credit batch. */
export async function getRecordCreditBatches(
  ctx: OrgContext,
  input: RecordCreditBatchesInput,
): Promise<RecordCreditBatches> {
  requireOrgScope(ctx);
  const table = { feedstock: feedstocks, delivery: deliveries, application: applications }[input.kind];
  await assertSameOrg(ctx, table, input.id);

  if (input.kind === "application") {
    const held = await getMixBinHeldApplicationIds(ctx, db, [input.id]);
    if (held.has(input.id)) return { batches: [] };

    const slices = await db.selectDistinct(batchSelection)
      .from(creditBatchApplications)
      .innerJoin(creditBatches, and(
        eq(creditBatches.id, creditBatchApplications.creditBatchId),
        eq(creditBatches.organizationId, ctx.organizationId),
      )).where(and(
        eq(creditBatchApplications.organizationId, ctx.organizationId),
        eq(creditBatchApplications.applicationId, input.id),
      )).orderBy(creditBatches.startDate, creditBatches.code);
    // Saved slices take precedence over current source-run membership.
    if (slices.length) return { batches: slices };

    // Same positive-share predicate as inApplicationCreditBatchLineage.
    const shares = await db.selectDistinct({ id: applicationOutputAllocations.productionRunId })
      .from(applicationOutputAllocations).where(and(
        eq(applicationOutputAllocations.organizationId, ctx.organizationId),
        eq(applicationOutputAllocations.applicationId, input.id),
        or(gt(applicationOutputAllocations.wetMassKg, "0"), gt(applicationOutputAllocations.dryMassKg, "0")),
      ));
    return { batches: await batchesForRuns(ctx, shares.map(share => share.id)) };
  }

  const runs = input.kind === "feedstock"
    ? await db.selectDistinct({ id: productionRunFeedstocks.productionRunId })
      .from(productionRunFeedstocks).where(and(
        eq(productionRunFeedstocks.organizationId, ctx.organizationId),
        eq(productionRunFeedstocks.feedstockId, input.id),
      ))
    : await deliveryRuns(ctx, input.id);
  return { batches: await batchesForRuns(ctx, runs.map(run => run.id)) };
}

/** All three source-run paths resolve membership through this one helper. */
async function batchesForRuns(ctx: OrgContext, runIds: string[]): Promise<RecordCreditBatch[]> {
  if (!runIds.length) return [];
  return db.selectDistinct(batchSelection).from(creditBatchProductionRuns)
    .innerJoin(productionRuns, and(
      eq(productionRuns.id, creditBatchProductionRuns.productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
    )).innerJoin(creditBatches, and(
      eq(creditBatches.id, creditBatchProductionRuns.creditBatchId),
      eq(creditBatches.organizationId, ctx.organizationId),
    )).where(and(
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      inArray(creditBatchProductionRuns.productionRunId, runIds),
    )).orderBy(creditBatches.startDate, creditBatches.code);
}

/** Keep the joins and per-product/run netting of inDeliveryCreditBatchLineage. */
async function deliveryRuns(ctx: OrgContext, deliveryId: string) {
  return db.select({ id: outputStockRunAllocations.productionRunId })
    .from(outputStockAllocations)
    .innerJoin(outputStockRunAllocations, and(
      eq(outputStockRunAllocations.allocationId, outputStockAllocations.id),
      eq(outputStockRunAllocations.organizationId, ctx.organizationId),
    )).innerJoin(deliveries, and(
      eq(deliveries.id, outputStockAllocations.deliveryId),
      eq(deliveries.organizationId, ctx.organizationId),
      eq(deliveries.storageLocationId, outputStockAllocations.sourceStorageLocationId),
    )).innerJoin(productionRuns, and(
      eq(productionRuns.id, outputStockRunAllocations.productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
      eq(productionRuns.facilityId, deliveries.facilityId),
    )).innerJoin(biocharProducts, and(
      eq(biocharProducts.id, outputStockAllocations.biocharProductId),
      eq(biocharProducts.organizationId, ctx.organizationId),
      eq(biocharProducts.facilityId, deliveries.facilityId),
    )).where(and(
      eq(outputStockAllocations.organizationId, ctx.organizationId),
      eq(outputStockAllocations.deliveryId, deliveryId),
    )).groupBy(outputStockAllocations.biocharProductId, outputStockRunAllocations.productionRunId)
    .having(sql`sum(${outputStockRunAllocations.dryMassKg}) > 0`);
}
