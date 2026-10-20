import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  creditBatchApplications, creditBatchProductionRuns, creditBatches, deliveries,
  feedstocks,
  productionRunFeedstocks, productionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordCreditBatchesInput } from "@/schemas/record-credit-batches";
import type { RecordCreditBatch, RecordCreditBatches } from "@/types/record-credit-batches";
import { getMixBinHeldApplicationIds } from "./mix-bin-credit-hold";
import { inApplicationCreditBatchLineage, inDeliveryCreditBatchLineage } from "./credit-batch-lineage-filter";
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
    if (held.has(input.id)) {
      // A held-out application retains only slices already owned by a Removal.
      const ownedSlices = await db.selectDistinct(batchSelection)
        .from(creditBatchApplications)
        .innerJoin(creditBatches, and(
          eq(creditBatches.id, creditBatchApplications.creditBatchId),
          eq(creditBatches.organizationId, ctx.organizationId),
        )).where(and(
          eq(creditBatchApplications.organizationId, ctx.organizationId),
          eq(creditBatchApplications.applicationId, input.id),
          isNotNull(creditBatchApplications.removalId),
        )).orderBy(creditBatches.startDate, creditBatches.code);
      return { batches: ownedSlices, heldOut: ownedSlices.length === 0 };
    }

    // Otherwise include the union of frozen slices and positive source-run shares.
    const batches = await db.select(batchSelection).from(creditBatches).where(and(
      eq(creditBatches.organizationId, ctx.organizationId),
      inApplicationCreditBatchLineage(ctx, creditBatches.id, input.id),
    )).orderBy(creditBatches.startDate, creditBatches.code);
    return { batches, heldOut: false };
  }

  if (input.kind === "delivery") {
    const batches = await db.select(batchSelection).from(creditBatches).where(and(
      eq(creditBatches.organizationId, ctx.organizationId),
      inDeliveryCreditBatchLineage(ctx, creditBatches.id, input.id),
    )).orderBy(creditBatches.startDate, creditBatches.code);
    return { batches, heldOut: false };
  }

  const runs = await db.selectDistinct({ id: productionRunFeedstocks.productionRunId })
    .from(productionRunFeedstocks).where(and(
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
      eq(productionRunFeedstocks.feedstockId, input.id),
    ));
  return { batches: await batchesForRuns(ctx, runs.map(run => run.id)), heldOut: false };
}

/** Resolve feedstock source runs through explicit batch membership. */
async function batchesForRuns(ctx: OrgContext, runIds: string[]): Promise<RecordCreditBatch[]> {
  requireOrgScope(ctx);
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
