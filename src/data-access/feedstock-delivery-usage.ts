import { touchedRunFeedstock } from './touched-run-feedstock';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import { creditBatchProductionRuns, creditBatches, feedstocks, productionRunFeedstocks, productionRuns } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import type { FeedstockDeliveryUsage } from '@/types/feedstock-delivery-usage';
import { CANCELLED_PRODUCTION_RUN_STATUS } from '@/lib/production-runs/lifecycle';
import { MASS_PRECISION_FACTOR } from '@/lib/feedstock-draw-replay';
import { replayFeedstockBinStock } from './feedstock-bin-ledger';
import { getFeedstockTransportOwnerBatches } from './feedstock-transport-ownership';
import { requireOrgScope } from './utils';

/** Saved run shares and the same physical replay used by the bin card. */
export async function getFeedstockDeliveryUsage(ctx: OrgContext, input: { feedstockIds: readonly string[] } | { creditBatchId: string },
  reader: Pick<typeof db, 'select' | 'selectDistinct'> = db): Promise<FeedstockDeliveryUsage[]> {
  requireOrgScope(ctx);
  const links = 'creditBatchId' in input ? await reader.select({ feedstockId: productionRunFeedstocks.feedstockId })
    .from(productionRunFeedstocks).innerJoin(creditBatchProductionRuns, and(
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId), eq(creditBatchProductionRuns.productionRunId, productionRunFeedstocks.productionRunId),
    )).where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), touchedRunFeedstock(), eq(creditBatchProductionRuns.creditBatchId, input.creditBatchId))) : input.feedstockIds.map(feedstockId => ({ feedstockId }));
  const ids = [...new Set(links.map(row => row.feedstockId))];
  if (!ids.length) return [];
  const deliveries = await reader.select().from(feedstocks).where(and(eq(feedstocks.organizationId, ctx.organizationId), inArray(feedstocks.id, ids)));
  const shares = await reader.select({ feedstockId: productionRunFeedstocks.feedstockId, wetKg: productionRunFeedstocks.wetMassUsedKg,
    creditBatchId: creditBatches.id, code: creditBatches.code }).from(productionRunFeedstocks)
    .innerJoin(productionRuns, and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, productionRunFeedstocks.productionRunId), ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS)))
    .leftJoin(creditBatchProductionRuns, and(eq(creditBatchProductionRuns.organizationId, ctx.organizationId), eq(creditBatchProductionRuns.productionRunId, productionRuns.id)))
    .leftJoin(creditBatches, and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, creditBatchProductionRuns.creditBatchId)))
    .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), touchedRunFeedstock(), inArray(productionRunFeedstocks.feedstockId, ids)));
  const owners = await getFeedstockTransportOwnerBatches(ctx, ids, reader);
  const result = new Map(deliveries.map((delivery): [string, FeedstockDeliveryUsage] => [delivery.id, {
    id: delivery.id, code: delivery.code, intakeWetKg: Number(delivery.massWetKg), stillInBinWetKg: 0, lostWetKg: 0, countWetKg: 0, ingredientWetKg: 0,
    creditBatches: [], unbatchedRunWetKg: 0, owningBatch: owners.get(delivery.id)?.[0] ?? null,
  }]));
  const add = (left: number, right: number) => Math.round((left + right) * MASS_PRECISION_FACTOR) / MASS_PRECISION_FACTOR;
  for (const share of shares) {
    const usage = result.get(share.feedstockId)!;
    if (!share.creditBatchId) usage.unbatchedRunWetKg = add(usage.unbatchedRunWetKg, share.wetKg);
    else {
      let batch = usage.creditBatches.find(row => row.creditBatchId === share.creditBatchId);
      if (!batch) { batch = { creditBatchId: share.creditBatchId, code: share.code!, wetKg: 0 }; usage.creditBatches.push(batch); }
      batch.wetKg = add(batch.wetKg, share.wetKg);
    }
  }
  for (const binId of new Set(deliveries.flatMap(row => row.storageLocationId ? [row.storageLocationId] : []))) {
    const ledger = await replayFeedstockBinStock(ctx, binId, reader);
    for (const batch of ledger.batches) {
      const usage = result.get(batch.id);
      if (usage) usage.stillInBinWetKg = batch.wetKg;
    }
    for (const event of ledger.entries) {
      if (event.reversed || !['loss', 'ingredient_draw', 'count'].includes(event.kind)) continue;
      for (const share of ledger.withdrawals.get(event.id) ?? []) {
        const usage = result.get(share.feedstockId);
        if (!usage) continue;
        if (event.kind === 'loss') usage.lostWetKg = add(usage.lostWetKg, share.wetKg);
        else if (event.kind === 'count') usage.countWetKg = add(usage.countWetKg, share.wetKg);
        else usage.ingredientWetKg = add(usage.ingredientWetKg, share.wetKg);
      }
    }
  }
  return [...result.values()].sort((a, b) => a.code.localeCompare(b.code));
}
