import { getTransportFreezeFeedstockIds, prepareFeedstockTransportOwnershipFreeze, type TransportOwnershipChange, type TransportOwnershipFreezeScope } from "./feedstock-transport-ownership-freeze";
import { and, eq, gte, inArray, ne } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { productionRunFeedstockDraws, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { formatFacilityDate } from "@/lib/date-utils";
import { withProductionRunErrors } from "@/lib/production-run-domain-errors";
import { assertLockedLineagesAllowMutation, tryLockCertifiedLineageArtifacts } from "./certification-lineage-guards";
import { allocateFeedstockWetMass, type FeedstockWetAllocation } from "./feedstock-wet-stock";
import { assertStockLockSnapshot, lockBinStocks } from "./lock-bin-stocks";
import { getOutputStockFacilityTimezone } from "./output-stock-dates";
import { requireOrgScope } from "./utils";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rebuild provenance in the caller's transaction. Callers hold the changed bin
 * locks before changing inputs. Lock every other source bin before reading its
 * basis, then the runs in ID order, then transport-owner advisory locks before
 * one ownership snapshot for the entire rebuild. Transaction retries handle the existing
 * intake-row/bin lock inversion shared with production-run writers.
 *
 * A run writer can restrict this to its own run; an intake writer visits every
 * potentially affected run drawing from either bin, including runs without an
 * existing intake link. Facility edits hold the facility row first, then bins,
 * then runs, matching run writers. These locks never authorize stock writes;
 * callers validate active bins for their own stock mutations.
 */
export async function reallocateRunsForBins(
  ctx: OrgContext,
  tx: DbTransaction,
  binIds: readonly (string | null)[],
  options: { onlyRunId?: string; earliestDeliveryDate?: Date; facilityId?: string; transportOwnershipFreeze?: TransportOwnershipFreezeScope; change?: TransportOwnershipChange } = {},
): Promise<void> {
  requireOrgScope(ctx);
  const { onlyRunId } = options;
  const ids = [...new Set(binIds.filter((id): id is string => id !== null))];
  if (!ids.length) return;
  await lockBinStocks(ctx, tx, ids, { allowArchived: true });
  // Delivery dates are UTC-midnight calendar values. One day of padding covers
  // every facility offset; the per-run allocation still uses the exact day.
  const earliestStart = options.earliestDeliveryDate && !onlyRunId
    ? new Date(options.earliestDeliveryDate.getTime() - DAY_MS) : undefined;
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
      // edit never rebuilds them; their own save (onlyRunId) still does.
      onlyRunId ? undefined : ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
      onlyRunId ? eq(productionRunFeedstockDraws.productionRunId, onlyRunId) : undefined,
      earliestStart ? gte(productionRuns.startTime, earliestStart) : undefined,
      options.facilityId ? eq(productionRuns.facilityId, options.facilityId) : undefined,
    ));
  const runIds = [...new Set(affected.map(row => row.runId))].sort();
  if (!runIds.length) return;

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

  const freeze = await prepareFeedstockTransportOwnershipFreeze(ctx, tx,
    options.transportOwnershipFreeze ? [] : await getTransportFreezeFeedstockIds(ctx, tx, {
      binIds: [...ids, ...draws.map(draw => draw.storageLocationId)], runIds,
    }), options.change ?? { mutation: "update", subject: "production run" }, options.transportOwnershipFreeze);
  await freeze(async () => {
    for (const run of runs) {
      if (!onlyRunId && run.status === CANCELLED_PRODUCTION_RUN_STATUS) continue;
      const timezone = await getOutputStockFacilityTimezone(ctx, run.facilityId, tx);
      const cutoffDay = formatFacilityDate(run.startTime, timezone);
      const proposed: FeedstockWetAllocation[] = [];
      const runDraws = draws.filter(draw => draw.productionRunId === run.id);
      if (onlyRunId) runDraws.sort((a, b) => ids.indexOf(a.storageLocationId) - ids.indexOf(b.storageLocationId));
      for (const [index, draw] of runDraws.entries()) {
        try {
          proposed.push(...await withProductionRunErrors(() => allocateFeedstockWetMass(
            ctx, tx, draw.storageLocationId, draw.wetMassKg, cutoffDay,
          ), ["feedstockDraws", index, "storageLocationId"]));
        } catch (error) {
          if (run.id !== onlyRunId && error instanceof DomainError) {
            throw new DomainError(error.code, `Run ${run.code}: ${error.message}`, {
              ...error,
              issues: error.issues.map(issue => ({ ...issue, message: `Run ${run.code}: ${issue.message}` })),
              cause: error,
            });
          }
          throw error;
        }
      }
      const saved = await tx.select({ feedstockId: productionRunFeedstocks.feedstockId, wetMassUsedKg: productionRunFeedstocks.wetMassUsedKg })
        .from(productionRunFeedstocks).where(and(
          eq(productionRunFeedstocks.organizationId, ctx.organizationId),
          eq(productionRunFeedstocks.productionRunId, run.id),
        ));
      const previous = new Map(saved.map(row => [row.feedstockId, row.wetMassUsedKg]));
      if (saved.length === proposed.length && proposed.every(row => previous.get(row.feedstockId) === row.wetMassUsedKg)) continue;

      const target = { entityType: "productionRun" as const, entityId: run.id };
      // We already hold bin/row locks. Never wait for an artifact held by a
      // submission that could be waiting for those same rows.
      const artifacts = await tryLockCertifiedLineageArtifacts(ctx, tx, [target]);
      assertStockLockSnapshot(artifacts !== null);
      await assertLockedLineagesAllowMutation(ctx, tx, artifacts!, [{ target, mutation: "update" }]);
      await tx.delete(productionRunFeedstocks).where(and(
        eq(productionRunFeedstocks.organizationId, ctx.organizationId),
        eq(productionRunFeedstocks.productionRunId, run.id),
      ));
      if (proposed.length) await tx.insert(productionRunFeedstocks).values(proposed.map(row => ({
        ...row, organizationId: ctx.organizationId, productionRunId: run.id,
      })));
    }
  });
}

/** Caller holds the facility FOR UPDATE through the timezone write and rebuild. */
export async function reallocateRunsForFacility(ctx: OrgContext, tx: DbTransaction, facilityId: string, change?: TransportOwnershipChange): Promise<void> {
  requireOrgScope(ctx);
  const draws = await tx.select({ binId: productionRunFeedstockDraws.storageLocationId })
    .from(productionRunFeedstockDraws).innerJoin(productionRuns, and(
      eq(productionRuns.id, productionRunFeedstockDraws.productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
    )).where(and(
      eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
      eq(productionRuns.facilityId, facilityId),
    ));
  await reallocateRunsForBins(ctx, tx, draws.map(draw => draw.binId), { facilityId, change });
}
