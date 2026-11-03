import { and, eq, inArray } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { certifierRemovals, feedstocks, productionRunFeedstockDraws, productionRuns, storageLocations, transportLegs } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { DomainError } from '@/lib/domain-errors';
import { getRecordLocks } from './certification-lineage-guards';
import { reallocateRunsForBins } from './feedstock-run-allocations';
import { getFeedstockTransportOwnerBatches } from './feedstock-transport-ownership';
import { lockBinStocks } from './lock-bin-stocks';
import { requireOrgScope } from './utils';

async function ownedLegCounts(ctx: OrgContext, tx: DbTransaction, storageLocationId: string) {
  requireOrgScope(ctx);
  const stocks = await tx.select({ id: feedstocks.id }).from(feedstocks).where(and(
    eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.storageLocationId, storageLocationId),
  ));
  const ids = stocks.map(row => row.id);
  if (!ids.length) return {};
  const owners = await getFeedstockTransportOwnerBatches(ctx, ids, tx);
  const legs = await tx.select({ feedstockId: transportLegs.entityId }).from(transportLegs).where(and(
    eq(transportLegs.organizationId, ctx.organizationId), eq(transportLegs.entityType, 'feedstock'), inArray(transportLegs.entityId, ids),
  ));
  const counts: Record<string, number> = {};
  for (const leg of legs) for (const owner of owners.get(leg.feedstockId) ?? []) counts[owner.code] = (counts[owner.code] ?? 0) + 1;
  return counts;
}

/** One bin is atomic: a locked lineage rolls back that bin, while the CLI continues other bins. */
export async function recalculateFeedstockBin(ctx: OrgContext, tx: DbTransaction, storageLocationId: string) {
  requireOrgScope(ctx);
  await lockBinStocks(ctx, tx, [storageLocationId], { allowArchived: true });
  const [bin] = await tx.select({ code: storageLocations.code }).from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId),
  ));
  const before = await ownedLegCounts(ctx, tx, storageLocationId);
  let rewrittenRunIds: string[] = [];
  const refused: { runId: string; code: string; removalCodes: string[] }[] = [];
  try {
    rewrittenRunIds = await tx.transaction(savepoint => reallocateRunsForBins(ctx, savepoint, [storageLocationId]));
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'certification_locked') throw error;
    const runs = await tx.select({ id: productionRuns.id, code: productionRuns.code }).from(productionRunFeedstockDraws)
      .innerJoin(productionRuns, and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, productionRunFeedstockDraws.productionRunId)))
      .where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), eq(productionRunFeedstockDraws.storageLocationId, storageLocationId)));
    const locks = await getRecordLocks(ctx, tx, runs.map(run => ({ entityType: 'productionRun', entityId: run.id })), { sentOnly: true });
    const removalIds = locks.flatMap(lock => lock.heldBy.map(holder => holder.id));
    const removals = removalIds.length ? await tx.select({ id: certifierRemovals.id, code: certifierRemovals.code }).from(certifierRemovals).where(and(
      eq(certifierRemovals.organizationId, ctx.organizationId), inArray(certifierRemovals.id, removalIds),
    )) : [];
    for (const [index, lock] of locks.entries()) if (lock.level === 'sent') refused.push({ runId: runs[index].id, code: runs[index].code,
      removalCodes: removals.filter(row => lock.heldBy.some(holder => holder.id === row.id)).map(row => row.code) });
    if (!refused.length) throw error;
  }
  return { storageLocationId, code: bin.code, runsRewritten: rewrittenRunIds.length, runsRefused: refused.length, rewrittenRunIds, refused, ownedLegsBefore: before,
    ownedLegsAfter: await ownedLegCounts(ctx, tx, storageLocationId) };
}
