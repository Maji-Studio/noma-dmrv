import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, creditBatchProductionRuns, facilities, storageLocations, productionRuns, productionRunFeedstocks, feedstocks } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";
import { productionRunDateExpr } from "./production-runs/date-expr";
import type { CreditBatchProductionRunOption } from "./credit-batch-production-run-options";

/** Persisted members only, including facility-cascade archives. Never authorizes writes. */
export async function getLinkedCreditBatchMembers(ctx: OrgContext, creditBatchId: string): Promise<CreditBatchProductionRunOption[]> {
  requireOrgScope(ctx);
  const rows = await db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRunDateExpr(ctx.organizationId),
      status: productionRuns.status,
      biocharStorageName: storageLocations.name,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      feedstockMassDryKg: productionRuns.feedstockMassDryKg,
      dieselOperationLiters: productionRuns.dieselOperationLiters,
      dieselGensetLiters: productionRuns.dieselGensetLiters,
      preprocessingFuelLiters: productionRuns.preprocessingFuelLiters,
      electricityKwh: productionRuns.electricityKwh,
      assignedCreditBatchId: creditBatchProductionRuns.creditBatchId,
      assignedCreditBatchCode: creditBatches.code,
    })
    .from(productionRuns)
    .leftJoin(
      storageLocations,
      and(
        eq(productionRuns.biocharStorageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .innerJoin(
      creditBatchProductionRuns,
      and(eq(creditBatchProductionRuns.productionRunId, productionRuns.id), eq(creditBatchProductionRuns.organizationId, ctx.organizationId)),
    )
    .innerJoin(
      creditBatches,
      and(eq(creditBatches.id, creditBatchProductionRuns.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)),
    )
    .innerJoin(facilities, and(
      eq(facilities.id, productionRuns.facilityId),
      eq(facilities.id, creditBatches.facilityId),
      eq(facilities.organizationId, ctx.organizationId),
    ))
    .where(and(
      eq(productionRuns.organizationId, ctx.organizationId),
      eq(creditBatches.id, creditBatchId),
      or(isNull(productionRuns.archivedAt), and(isNotNull(facilities.archivedAt), eq(productionRuns.archivedAt, facilities.archivedAt))),
      or(isNull(creditBatches.archivedAt), and(isNotNull(facilities.archivedAt), eq(creditBatches.archivedAt, facilities.archivedAt))),
    ))
    .orderBy(desc(productionRuns.startTime));

  // Load distinct feedstock types separately to avoid duplicating member rows.
  const runIds = rows.map((row) => row.id);
  const typeRows = runIds.length
    ? await db
        .selectDistinct({
          productionRunId: productionRunFeedstocks.productionRunId,
          feedstockTypeId: feedstocks.feedstockTypeId,
        })
        .from(productionRunFeedstocks)
        .innerJoin(
          feedstocks,
          and(eq(feedstocks.id, productionRunFeedstocks.feedstockId), eq(feedstocks.organizationId, ctx.organizationId)),
        )
        .where(and(inArray(productionRunFeedstocks.productionRunId, runIds), eq(productionRunFeedstocks.organizationId, ctx.organizationId)))
    : [];
  const typesByRun = new Map<string, string[]>();
  for (const typeRow of typeRows) {
    const list = typesByRun.get(typeRow.productionRunId) ?? [];
    list.push(typeRow.feedstockTypeId);
    typesByRun.set(typeRow.productionRunId, list);
  }

  return rows.map((row) => ({
    ...row,
    feedstockTypeIds: typesByRun.get(row.id) ?? [],
  }));
}
