import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { productionRunFeedstockDraws, productionRunFeedstocks, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formatFacilityDate } from "@/lib/date-utils";
import { withProductionRunErrors } from "@/lib/production-run-domain-errors";
import { assertLockedLineagesAllowMutation, tryLockCertifiedLineageArtifacts } from "./certification-lineage-guards";
import { allocateFeedstockWetMass, type FeedstockWetAllocation } from "./feedstock-wet-stock";
import { assertStockLockSnapshot, lockBinStocks } from "./lock-bin-stocks";
import { getOutputStockFacilityTimezone } from "./output-stock-dates";
import { requireOrgScope } from "./utils";

/**
 * Rebuild provenance in the caller's transaction. Callers hold the changed bin
 * locks before changing inputs. Lock every other source bin before reading its
 * basis, then the runs in ID order. Transaction retries handle the existing
 * intake-row/bin lock inversion shared with production-run writers.
 *
 * A run writer can restrict this to its own run; an intake writer visits every
 * run drawing from either bin, including runs without an existing intake link.
 */
export async function reallocateRunsForBins(
  ctx: OrgContext,
  tx: DbTransaction,
  binIds: readonly (string | null)[],
  onlyRunId?: string,
): Promise<void> {
  requireOrgScope(ctx);
  const ids = [...new Set(binIds.filter((id): id is string => id !== null))];
  if (!ids.length) return;
  await lockBinStocks(ctx, tx, ids);
  const affected = await tx.select({ runId: productionRunFeedstockDraws.productionRunId })
    .from(productionRunFeedstockDraws)
    .where(and(
      eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
      inArray(productionRunFeedstockDraws.storageLocationId, ids),
      onlyRunId ? eq(productionRunFeedstockDraws.productionRunId, onlyRunId) : undefined,
    ));
  const runIds = [...new Set(affected.map(row => row.runId))].sort();
  if (!runIds.length) return;

  const draws = await tx.select().from(productionRunFeedstockDraws).where(and(
    eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
    inArray(productionRunFeedstockDraws.productionRunId, runIds),
  )).orderBy(productionRunFeedstockDraws.productionRunId, productionRunFeedstockDraws.storageLocationId);
  await lockBinStocks(ctx, tx, draws.map(draw => draw.storageLocationId));
  const runs = await tx.select().from(productionRuns).where(and(
    eq(productionRuns.organizationId, ctx.organizationId), inArray(productionRuns.id, runIds),
  )).orderBy(productionRuns.id).for("update");
  // A concurrent writer may have changed another source while we acquired it.
  const currentDraws = await tx.select().from(productionRunFeedstockDraws).where(and(
    eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
    inArray(productionRunFeedstockDraws.productionRunId, runIds),
  )).orderBy(productionRunFeedstockDraws.productionRunId, productionRunFeedstockDraws.storageLocationId);
  assertStockLockSnapshot(JSON.stringify(draws) === JSON.stringify(currentDraws));

  for (const run of runs) {
    const timezone = await getOutputStockFacilityTimezone(ctx, run.facilityId, tx);
    const cutoffDay = formatFacilityDate(run.startTime, timezone);
    const proposed: FeedstockWetAllocation[] = [];
    const runDraws = draws.filter(draw => draw.productionRunId === run.id);
    if (onlyRunId) runDraws.sort((a, b) => ids.indexOf(a.storageLocationId) - ids.indexOf(b.storageLocationId));
    for (const [index, draw] of runDraws.entries()) {
      proposed.push(...await withProductionRunErrors(() => allocateFeedstockWetMass(
        ctx, tx, draw.storageLocationId, draw.wetMassKg, cutoffDay,
      ), ["feedstockDraws", index, "storageLocationId"]));
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
}
