import { and, eq, inArray } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { certifierRemovals, feedstocks, productionRunFeedstockDraws, productionRuns, storageLocations, transportLegs } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { compareFeedstockEvents } from '@/lib/feedstock-draw-replay';
import { DomainError } from '@/lib/domain-errors';
import { getRecordLocks } from './certification-lineage-guards';
import { reallocateRunsForBins, SentRunRewriteRefusedError } from './feedstock-run-allocations';
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

async function getRemovalCodes(ctx: OrgContext, tx: DbTransaction, ids: string[]) {
  requireOrgScope(ctx);
  if (!ids.length) return [];
  const removals = await tx.select({ code: certifierRemovals.code }).from(certifierRemovals).where(and(
    eq(certifierRemovals.organizationId, ctx.organizationId), inArray(certifierRemovals.id, ids),
  ));
  return removals.map(row => row.code);
}

/** Inventory stays inside the verified organization scope. */
export async function listFeedstockRecalculationBins(ctx: OrgContext, reader: Pick<DbTransaction, 'select'>) {
  requireOrgScope(ctx);
  return reader.select({ id: storageLocations.id, code: storageLocations.code }).from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.type, 'feedstock_bin'),
  )).orderBy(storageLocations.id);
}

/** One bin is atomic: a locked lineage rolls back that bin, while the CLI continues other bins. */
export async function recalculateFeedstockBin(ctx: OrgContext, tx: DbTransaction, storageLocationId: string, options: { allowSentRewrite?: boolean } = {}) {
  requireOrgScope(ctx);
  if (options.allowSentRewrite && process.env.NODE_ENV === 'production') throw new DomainError('forbidden', 'Sent allocations cannot be rewritten in production.');
  await lockBinStocks(ctx, tx, [storageLocationId], { allowArchived: true });
  const [bin] = await tx.select({ code: storageLocations.code }).from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId),
  ));
  const before = await ownedLegCounts(ctx, tx, storageLocationId);
  const runs = await tx.select({ id: productionRuns.id, code: productionRuns.code, startTime: productionRuns.startTime,
    recordedAt: productionRunFeedstockDraws.createdAt, drawId: productionRunFeedstockDraws.id }).from(productionRunFeedstockDraws)
    .innerJoin(productionRuns, and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, productionRunFeedstockDraws.productionRunId)))
    .where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), eq(productionRunFeedstockDraws.storageLocationId, storageLocationId)));
  const locks = await getRecordLocks(ctx, tx, runs.map(run => ({ entityType: 'productionRun', entityId: run.id })), { sentOnly: true });
  const kept = runs.filter((_, index) => locks[index].level === 'sent');
  const last = [...(options.allowSentRewrite ? [] : kept)].sort((a, b) => compareFeedstockEvents(
    { id: a.drawId, occurredAt: a.startTime.toISOString(), recordedAt: a.recordedAt.toISOString(), kind: 'run_draw', wetDeltaKg: null },
    { id: b.drawId, occurredAt: b.startTime.toISOString(), recordedAt: b.recordedAt.toISOString(), kind: 'run_draw', wetDeltaKg: null },
  )).at(-1);
  const removalIds = locks.flatMap(lock => lock.heldBy.map(holder => holder.id));
  const removals = removalIds.length ? await tx.select({ id: certifierRemovals.id, code: certifierRemovals.code }).from(certifierRemovals).where(and(
    eq(certifierRemovals.organizationId, ctx.organizationId), inArray(certifierRemovals.id, removalIds),
  )) : [];
  let rewrittenRunIds: string[] = [];
  const refused: { runId?: string; code?: string; feedstockId?: string; removalCodes: string[] }[] = [];
  try {
    rewrittenRunIds = await tx.transaction(savepoint => reallocateRunsForBins(ctx, savepoint, [storageLocationId], last ? {
      earliestEventAt: last.startTime, eventTie: { recordedAt: last.recordedAt, id: last.drawId }, boundaryExclusive: true,
    } : options.allowSentRewrite ? { allowSentRewrite: true } : {}));
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'certification_locked') throw error;
    if (error instanceof SentRunRewriteRefusedError) {
      const [lock] = await getRecordLocks(ctx, tx, [{ entityType: 'productionRun', entityId: error.runId }], { sentOnly: true });
      refused.push({ runId: error.runId, code: error.runCode,
        removalCodes: await getRemovalCodes(ctx, tx, lock.heldBy.map(holder => holder.id)) });
    } else {
      for (const issue of error.issues) {
        const meta = issue.meta;
        if (typeof meta?.feedstockId !== 'string') continue;
        const [feedstock] = await tx.select({ code: feedstocks.code }).from(feedstocks).where(and(
          eq(feedstocks.organizationId, ctx.organizationId), eq(feedstocks.id, meta.feedstockId),
        ));
        const ids = Array.isArray(meta.removalIds) ? meta.removalIds.filter((id): id is string => typeof id === 'string') : [];
        refused.push({ feedstockId: meta.feedstockId, code: feedstock?.code,
          removalCodes: await getRemovalCodes(ctx, tx, ids) });
      }
    }
    // A bin-level refusal still fails the command when a guard has no structured target.
    if (!refused.length) refused.push({ removalCodes: [] });
  }
  return { storageLocationId, code: bin.code, runsRewritten: rewrittenRunIds.length, runsRefused: refused.length, keptSentRuns: (options.allowSentRewrite ? [] : kept).map(run => ({ runId: run.id, code: run.code,
    removalCodes: removals.filter(row => locks[runs.indexOf(run)].heldBy.some(holder => holder.id === row.id)).map(row => row.code) })), rewrittenSentRuns: kept.filter(run => rewrittenRunIds.includes(run.id)).map(run => ({ runId: run.id, code: run.code,
      removalCodes: removals.filter(row => locks[runs.indexOf(run)].heldBy.some(holder => holder.id === row.id)).map(row => row.code) })), rewrittenRunIds, refused, ownedLegsBefore: before,
    ownedLegsAfter: await ownedLegCounts(ctx, tx, storageLocationId) };
}
