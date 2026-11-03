import { earliestFeedstockEventTie } from '@/lib/feedstock-event-boundary';
import { prepareFeedstockTransportOwnershipFreeze, type TransportOwnershipChange, type TransportOwnershipFreezeScope } from "./feedstock-transport-ownership-freeze";
import { and, eq, gt, gte, inArray, ne, or, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { productionRunFeedstockDraws, productionRunFeedstocks, productionRuns, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { FeedstockReplayOverdrawError } from "@/lib/feedstock-draw-replay";
import { replayFeedstockBinStock } from "./feedstock-bin-ledger";
import { withProductionRunErrors } from "@/lib/production-run-domain-errors";
import { assertLockedLineagesAllowMutation, tryLockCertifiedLineageArtifacts } from "./certification-lineage-guards";
import { throwFeedstockReplayOverdraw, type FeedstockWetAllocation } from "./feedstock-wet-stock";
import { assertStockLockSnapshot, lockBinStocks } from "./lock-bin-stocks";
import { requireOrgScope } from "./utils";

import { formatUtcDate, startOfFacilityDay } from '@/lib/date-utils';
import { getOutputStockFacilityTimezone } from './output-stock-dates';

/**
 * Rebuild provenance in the caller's transaction. Callers hold the changed bin
 * locks before changing inputs. Lock every other source bin before reading its
 * basis, then the runs in ID order, then transport-owner advisory locks for
 * every rewritten run before one ownership snapshot. Transaction retries handle the existing
 * intake-row/bin lock inversion shared with production-run writers.
 *
 * A run writer visits its run and all later runs; an intake writer visits every
 * potentially affected run drawing from either bin, including runs without an
 * existing intake link. Facility edits hold the facility row first, then bins,
 * then runs, matching run writers. These locks never authorize stock writes;
 * callers validate active bins for their own stock mutations.
 */
export async function reallocateRunsForBins(
  ctx: OrgContext,
  tx: DbTransaction,
  binIds: readonly (string | null)[],
  options: { allowSentRewrite?: boolean; onlyRunId?: string; boundaryExclusive?: boolean; earliestDeliveryDate?: Date; earliestEventAt?: Date; eventTie?: { recordedAt: Date; id: string }; facilityId?: string; transportOwnershipFreeze?: TransportOwnershipFreezeScope; change?: TransportOwnershipChange } = {},
): Promise<string[]> {
  requireOrgScope(ctx);
  if (options.allowSentRewrite && process.env.NODE_ENV === 'production') throw new DomainError('forbidden', 'Sent allocations cannot be rewritten in production.');
  const { onlyRunId } = options;
  const ids = [...new Set(binIds.filter((id): id is string => id !== null))];
  if (!ids.length) return [];
  await lockBinStocks(ctx, tx, ids, { allowArchived: true });
  const [edited] = onlyRunId ? await tx.select({ startTime: productionRuns.startTime, status: productionRuns.status }).from(productionRuns).where(and(
    eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, onlyRunId),
  )) : [];
  let earliestStart = options.earliestEventAt ?? edited?.startTime;
  if (options.earliestDeliveryDate) {
    const bins = await tx.select({ facilityId: storageLocations.facilityId }).from(storageLocations).where(and(
      eq(storageLocations.organizationId, ctx.organizationId), inArray(storageLocations.id, ids),
    ));
    const instants = await Promise.all(bins.map(async bin => startOfFacilityDay(formatUtcDate(options.earliestDeliveryDate!),
      await getOutputStockFacilityTimezone(ctx, bin.facilityId, tx)).getTime()));
    earliestStart = new Date(Math.min(...instants));
  }
  const recordedAt = sql`date_trunc('milliseconds', ${productionRunFeedstockDraws.createdAt})`;
  const runTies = onlyRunId ? await tx.select({ recordedAt: productionRunFeedstockDraws.createdAt, id: productionRunFeedstockDraws.id })
    .from(productionRunFeedstockDraws).where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), eq(productionRunFeedstockDraws.productionRunId, onlyRunId)))
    : [];
  const runTie = earliestFeedstockEventTie(runTies);
  // Replacing draws assigns new IDs. In one transaction the timestamp stays
  // equal, so the replacement may sort before the old boundary. Replan from
  // the earlier position, including any same-start runs between those IDs.
  const ties = [options.eventTie, !options.eventTie || edited?.startTime.getTime() === earliestStart?.getTime() ? runTie : undefined]
    .filter((value): value is { recordedAt: Date; id: string } => value !== undefined);
  const tie = earliestFeedstockEventTie(ties);
  const afterBoundary = earliestStart && tie ? or(gt(productionRuns.startTime, earliestStart), and(eq(productionRuns.startTime, earliestStart),
    or(gt(recordedAt, tie.recordedAt.toISOString()), and(eq(recordedAt, tie.recordedAt.toISOString()), (options.boundaryExclusive ? gt : gte)(productionRunFeedstockDraws.id, tie.id)))))
    : earliestStart ? gte(productionRuns.startTime, earliestStart) : undefined;
  const affected = await tx.select({ runId: productionRunFeedstockDraws.productionRunId })
    .from(productionRunFeedstockDraws)
    .innerJoin(productionRuns, and(
      eq(productionRuns.id, productionRunFeedstockDraws.productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
    ))
    .where(and(
      eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
      inArray(productionRunFeedstockDraws.storageLocationId, ids),
      // Cancelled runs keep their history and consume no stock, so another
      // edit never rebuilds their saved provenance.
      or(ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS), onlyRunId ? eq(productionRuns.id, onlyRunId) : undefined),
      afterBoundary,
      options.facilityId ? eq(productionRuns.facilityId, options.facilityId) : undefined,
    ));
  const runIds = [...new Set([...affected.map(row => row.runId),
    ...(onlyRunId && edited?.status === CANCELLED_PRODUCTION_RUN_STATUS ? [onlyRunId] : []),
  ])].sort();

  const readDrawSnapshot = () => tx.select().from(productionRunFeedstockDraws).where(and(
    eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
    inArray(productionRunFeedstockDraws.productionRunId, runIds),
  )).orderBy(productionRunFeedstockDraws.productionRunId, productionRunFeedstockDraws.storageLocationId);
  const draws = await readDrawSnapshot();
  await lockBinStocks(ctx, tx, draws.map(draw => draw.storageLocationId), { allowArchived: true });
  const runs = await tx.select().from(productionRuns).where(and(
    eq(productionRuns.organizationId, ctx.organizationId), inArray(productionRuns.id, runIds),
  )).orderBy(productionRuns.id).for("update");
  // A concurrent writer may have changed another source while we acquired it.
  const currentDraws = await readDrawSnapshot();
  assertStockLockSnapshot(JSON.stringify(draws) === JSON.stringify(currentDraws));

  const plans = new Map<string, FeedstockWetAllocation[]>();
  for (const binId of [...new Set([...ids, ...draws.map(draw => draw.storageLocationId)])]) {
    let ledger: Awaited<ReturnType<typeof replayFeedstockBinStock>>;
    try {
      ledger = await replayFeedstockBinStock(ctx, binId, tx, { historyRunId: edited?.status === CANCELLED_PRODUCTION_RUN_STATUS ? onlyRunId : undefined, replanRunIds: new Set(ids.includes(binId) ? runIds : []),
        boundary: ids.includes(binId) ? { occurredAt: earliestStart?.toISOString() ?? '', recordedAt: tie?.recordedAt.toISOString(), id: tie?.id, exclusive: options.boundaryExclusive } : undefined });
    } catch (error) {
      if (!(error instanceof FeedstockReplayOverdrawError)) throw error;
      if (error.event.kind !== 'run_draw') await throwFeedstockReplayOverdraw(ctx, tx, binId, error);
      const run = runs.find(row => row.id === error.event.sourceId)!;
      const runDraws = draws.filter(draw => draw.productionRunId === run.id);
      if (onlyRunId) runDraws.sort((a, b) => ids.indexOf(a.storageLocationId) - ids.indexOf(b.storageLocationId));
      const index = runDraws.findIndex(draw => draw.storageLocationId === binId);
      try {
        await withProductionRunErrors(() => throwFeedstockReplayOverdraw(ctx, tx, binId, error), ['feedstockDraws', index, 'storageLocationId']);
      } catch (failure) {
        if (run.id !== onlyRunId && failure instanceof DomainError) throw new DomainError(failure.code, `Run ${run.code}: ${failure.message}`, {
          ...failure, issues: failure.issues.map(issue => ({ ...issue, message: `Run ${run.code}: ${issue.message}` })), cause: failure,
        });
        throw failure;
      }
      throw error;
    }
    for (const entry of ledger.entries) {
      if (entry.kind !== 'run_draw' || !entry.sourceId || !runIds.includes(entry.sourceId)) continue;
      const shares = (ledger.withdrawals.get(entry.id) ?? []).map(row => ({ feedstockId: row.feedstockId, wetMassUsedKg: row.wetKg }));
      plans.set(entry.sourceId, [...(plans.get(entry.sourceId) ?? []), ...shares]);
    }
  }
  const rewrites: { run: typeof runs[number]; saved: { feedstockId: string }[]; proposed: FeedstockWetAllocation[] }[] = [];
  for (const run of runs) {
    if (run.status === CANCELLED_PRODUCTION_RUN_STATUS && run.id !== onlyRunId) continue;
    const proposed = plans.get(run.id) ?? [];
    const saved = await tx.select({ feedstockId: productionRunFeedstocks.feedstockId, wetMassUsedKg: productionRunFeedstocks.wetMassUsedKg })
      .from(productionRunFeedstocks).where(and(
        eq(productionRunFeedstocks.organizationId, ctx.organizationId),
        eq(productionRunFeedstocks.productionRunId, run.id),
      ));
    const previous = new Map(saved.map(row => [row.feedstockId, row.wetMassUsedKg]));
    if (saved.length === proposed.length && proposed.every(row => previous.get(row.feedstockId) === row.wetMassUsedKg)) continue;
    rewrites.push({ run, saved, proposed });
  }
  if (!rewrites.length) return [];

  // One snapshot over every rewritten run, so a handoff between them compares
  // the final owner rather than each intermediate one.
  const freeze = await prepareFeedstockTransportOwnershipFreeze(ctx, tx,
    rewrites.flatMap(({ saved, proposed }) => [...saved, ...proposed].map(row => row.feedstockId)),
    options.change ?? { mutation: "update", subject: "production run" }, options.transportOwnershipFreeze, { allowSentRewrite: options.allowSentRewrite });
  await freeze(async () => {
    for (const { run, proposed } of rewrites) {
      const target = { entityType: "productionRun" as const, entityId: run.id };
      // We already hold bin/row locks. Never wait for an artifact held by a
      // submission that could be waiting for those same rows.
      if (!options.allowSentRewrite) {
        const artifacts = await tryLockCertifiedLineageArtifacts(ctx, tx, [target]);
        assertStockLockSnapshot(artifacts !== null);
        try {
          await assertLockedLineagesAllowMutation(ctx, tx, artifacts!, [{ target, mutation: "update" }]);
        } catch (error) {
          if (!(error instanceof DomainError) || error.code !== 'certification_locked') throw error;
          throw new DomainError(error.code, error.message, { issues: error.issues.map(issue => ({ ...issue,
            meta: { ...issue.meta, runId: run.id, runCode: run.code } })), cause: error });
        }
      }
      await tx.delete(productionRunFeedstocks).where(and(
        eq(productionRunFeedstocks.organizationId, ctx.organizationId),
        eq(productionRunFeedstocks.productionRunId, run.id),
      ));
      if (proposed.length) await tx.insert(productionRunFeedstocks).values(proposed.map(row => ({
        ...row, organizationId: ctx.organizationId, productionRunId: run.id,
      })));
    }
  });
  return rewrites.map(({ run }) => run.id);
}

/** Caller holds the facility FOR UPDATE through the timezone write and rebuild. */
export async function reallocateRunsForFacility(ctx: OrgContext, tx: DbTransaction, facilityId: string, change?: TransportOwnershipChange): Promise<void> {
  requireOrgScope(ctx);
  const bins = await tx.select({ binId: storageLocations.id }).from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.facilityId, facilityId),
    eq(storageLocations.type, 'feedstock_bin'),
  ));
  await reallocateRunsForBins(ctx, tx, bins.map(bin => bin.binId), { facilityId, change });
}
