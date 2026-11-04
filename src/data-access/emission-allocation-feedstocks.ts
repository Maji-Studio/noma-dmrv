import { and, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { creditBatchProductionRuns, creditBatches, feedstocks, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formatFacilityDate, formatUtcDate } from "@/lib/date-utils";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import type { AllocationFeedstockFact } from "@/lib/certification/emission-allocation-facts";
import { getFeedstockDeliveryUsage } from "./feedstock-delivery-usage";
import { getFeedstockTransportOwners } from "./feedstock-transport-ownership";
import { getTransportLegsForEntities } from "./transport-legs";
import { requireOrgScope } from "./utils";

type Reader = Pick<typeof db, "select" | "selectDistinct">;

/** Only bins drawn by the facility's runs, plus explicit member-run feedstock links. */
export async function loadAllocationFeedstocks(ctx: OrgContext, facilityId: string, runIds: string[], timezone: string, reader: Reader) {
  requireOrgScope(ctx);
  if (!runIds.length) return [];
  const [draws, links] = await Promise.all([
    reader.select({ binId: productionRunFeedstockDraws.storageLocationId }).from(productionRunFeedstockDraws)
      .where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), inArray(productionRunFeedstockDraws.productionRunId, runIds))),
    reader.select({ feedstockId: productionRunFeedstocks.feedstockId, binId: feedstocks.storageLocationId }).from(productionRunFeedstocks)
      .innerJoin(feedstocks, and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.id, productionRunFeedstocks.feedstockId)))
      .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), inArray(productionRunFeedstocks.productionRunId, runIds))),
  ]);
  const binIds = [...new Set([...draws, ...links].map(row => row.binId))];
  const linkedIds = [...new Set(links.map(row => row.feedstockId))];
  if (!binIds.length && !linkedIds.length) return [];
  const rows = await reader.select({ stock: feedstocks, binName: storageLocations.name }).from(feedstocks)
    .innerJoin(storageLocations, and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, feedstocks.storageLocationId)))
    .where(and(eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.facilityId, facilityId),
      or(binIds.length ? inArray(feedstocks.storageLocationId, binIds) : undefined,
        linkedIds.length ? inArray(feedstocks.id, linkedIds) : undefined)));
  const ids = rows.map(row => row.stock.id);
  if (!ids.length) return [];
  const [usage, owners, legs, uses] = await Promise.all([
    getFeedstockDeliveryUsage(ctx, { feedstockIds: ids }, reader),
    getFeedstockTransportOwners(ctx, ids, reader),
    getTransportLegsForEntities(ctx, "feedstock", ids, reader),
    reader.select({ feedstockId: productionRunFeedstocks.feedstockId, runId: productionRuns.id, runCode: productionRuns.code,
      startTime: productionRuns.startTime, creditBatchId: creditBatches.id }).from(productionRunFeedstocks)
      .innerJoin(productionRuns, and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, productionRunFeedstocks.productionRunId),
        ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS)))
      .leftJoin(creditBatchProductionRuns, and(eq(creditBatchProductionRuns.organizationId, ctx.organizationId), eq(creditBatchProductionRuns.productionRunId, productionRuns.id)))
      .leftJoin(creditBatches, and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, creditBatchProductionRuns.creditBatchId)))
      .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), inArray(productionRunFeedstocks.feedstockId, ids))),
  ]);
  const usageById = new Map(usage.map(row => [row.id, row]));
  return rows.map(({ stock, binName }): AllocationFeedstockFact => {
    const draws = uses.filter(row => row.feedstockId === stock.id);
    const first = draws.find(row => row.runId === owners.get(stock.id));
    const runsByBatch: Record<string, string[]> = {};
    for (const draw of draws) {
      if (!draw.creditBatchId) continue;
      const codes = runsByBatch[draw.creditBatchId] ?? [];
      if (!codes.includes(draw.runCode)) codes.push(draw.runCode);
      runsByBatch[draw.creditBatchId] = codes.sort();
    }
    return {
      id: stock.id, code: stock.code, date: formatUtcDate(stock.deliveryDate), binId: stock.storageLocationId, binName,
      usage: usageById.get(stock.id)!, runsByBatch,
      firstRun: first?.creditBatchId ? { id: first.runId, code: first.runCode,
        date: formatFacilityDate(first.startTime, timezone), creditBatchId: first.creditBatchId } : undefined,
      legs: legs.filter(leg => leg.entityId === stock.id).map(leg => ({ id: leg.id, oneWayKm: leg.distanceKm, loadKg: leg.loadMassKg })),
    };
  });
}
