import { beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatchProductionRuns, creditBatches, productionProcesses, facilities, feedstocks, productionRunFeedstocks, productionRuns, storageLocations } from "@/db/schema";
import { updateFeedstockInTransaction } from "@/data-access/feedstocks";
import { failedRunFixture } from "./helpers/failed-run-fixture";
import { resolveFacilityTimezoneEdit } from "@/data-access/facility-timezone-guard";
import { getRecordLocks, getLockedCertifiedLineageForTargetSet, isSubmittedLineageRow } from "@/data-access/certification-lineage-guards";
import { getFeedstockTypeLinkLock, getLockedFeedstockTypeLinkLock } from "@/data-access/feedstock-type-link-lock";
import { resolveWriteActivityScopes } from "@/data-access/write-activity";
import { readUsedByDownstreamEdges, readUsedByUpstreamEdges } from "@/data-access/record-used-by-chain-links";
import { withLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();
beforeAll(() => ensureTestOrg());

async function makeFailed(f: LineageFixture) {
  await db.transaction(async tx => {
    await tx.delete(creditBatchProductionRuns).where(and(
      eq(creditBatchProductionRuns.organizationId, TEST_ORG_ID), eq(creditBatchProductionRuns.productionRunId, f.productionRunId),
    ));
    await tx.update(productionRuns).set({ status: "failed" })
      .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, f.productionRunId)));
  });
}

it.each(["removal", "ghgStatement"] as const)("discovers failed sources through %s in advisory and shared-reference lock reads", async holder => {
  await withLineageFixture(async f => {
    await makeFailed(f);
    await db.transaction(async tx => {
      const locks = await getRecordLocks(ctx, tx, [
        { entityType: "productionRun", entityId: f.productionRunId },
        { entityType: "feedstock", entityId: f.feedstockId },
      ]);
      expect(locks.map(lock => lock.level)).toEqual(["sent", "sent"]);
      for (const lock of locks) expect(lock.heldBy).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.removalId })]));
      const vehicleLineage = await getLockedCertifiedLineageForTargetSet(ctx, tx, { feedstockIds: [f.feedstockId], deliveryIds: [] });
      expect(vehicleLineage.filter(isSubmittedLineageRow)).toEqual(expect.arrayContaining([
        expect.objectContaining({ creditBatchId: f.batchId, removalId: f.removalId }),
      ]));
      expect(await getFeedstockTypeLinkLock(ctx, tx, f.feedstockTypeId)).toMatchObject({ locked: true });
      expect(await getLockedFeedstockTypeLinkLock(ctx, tx, f.feedstockTypeId)).toMatchObject({
        locked: true, removals: [expect.objectContaining({ id: f.removalId })],
      });
      expect(await getRecordLocks({ ...ctx, organizationId: crypto.randomUUID() }, tx,
        [{ entityType: "productionRun", entityId: f.productionRunId }], { sentOnly: true }))
        .toEqual([expect.objectContaining({ level: "open" })]);
    });
  }, holder);
});

it("labels emissions edges and resolves activity before a failed attachment moves", async () => {
  await withLineageFixture(async f => {
    await makeFailed(f);
    const edge = { from: `productionRun:${f.productionRunId}`, to: `creditBatch:${f.batchId}`, dependency: "production-emissions" };
    expect(await readUsedByDownstreamEdges(ctx, "productionRun", [f.productionRunId])).toContainEqual(edge);
    expect(await readUsedByUpstreamEdges(ctx, "creditBatch", f.batchId)).toContainEqual(edge);
    await db.transaction(async tx => {
      const oldScopes = await resolveWriteActivityScopes(ctx, tx, "production_run", f.productionRunId);
      expect(oldScopes).toEqual([{ creditBatchId: f.batchId, productionRunId: f.productionRunId }]);
      expect(await resolveWriteActivityScopes(ctx, tx, "feedstock", f.feedstockId)).toEqual(oldScopes);
      await tx.update(productionRuns).set({ endTime: new Date("2026-07-01T12:00:00Z") })
        .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, f.productionRunId)));
      expect(await resolveWriteActivityScopes(ctx, tx, "production_run", f.productionRunId))
        .toEqual([{ productionRunId: f.productionRunId }]);
      expect(oldScopes[0].creditBatchId).toBe(f.batchId);
    });
  });
});


it("refuses timezone changes with certification guidance for failed-only Sent sources", async () => {
  await withLineageFixture(async f => {
    await makeFailed(f);
    await expect(db.transaction(async tx => {
      const [facility] = await tx.select().from(facilities).where(and(
        eq(facilities.organizationId, TEST_ORG_ID), eq(facilities.id, f.facilityId),
      )).for("update");
      await resolveFacilityTimezoneEdit(ctx, tx, facility, "Africa/Dar_es_Salaam");
    })).rejects.toMatchObject({ code: "certification_locked", message: expect.stringContaining("Removal") });
    const [facility] = await db.select().from(facilities).where(eq(facilities.id, f.facilityId));
    expect(facility.timezone).toBe("UTC");
  });
});


const SOURCE_ROLLBACK = new Error("rollback failed source fixture");
it("refuses a type-only intake edit that resolves an unclaimed failed run into Sent with identical draw IDs and masses", async () => {
  await withLineageFixture(async holder => {
    await expect(db.transaction(async tx => {
      const f = await failedRunFixture(tx, { batch: false });
      // An intake in an untyped bin can be retyped without triggering
      // allocationChanged. The saved source links and their masses stay equal.
      await tx.update(storageLocations).set({ feedstockTypeId: null })
        .where(eq(storageLocations.id, f.stock.storageLocationId));
      const [process] = await tx.insert(productionProcesses).values({ ...f.site, feedstockTypeId: holder.feedstockTypeId }).returning();
      await tx.update(creditBatches).set({ facilityId: f.facility.id,
        productionProcessId: process.id,
        startDate: f.batchValues.startDate, endDate: f.batchValues.endDate })
        .where(eq(creditBatches.id, holder.batchId));
      const before = await tx.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, f.run.id));
      await expect(tx.transaction(savepoint => updateFeedstockInTransaction(ctx, savepoint, f.stock.id, {
        expectedVersion: f.stock.version, feedstockTypeId: holder.feedstockTypeId,
      }))).rejects.toMatchObject({ code: "certification_locked" });
      const [saved] = await tx.select().from(feedstocks).where(eq(feedstocks.id, f.stock.id));
      expect(saved.feedstockTypeId).toBe(f.type.id);
      expect(saved.version).toBe(f.stock.version);
      expect(await tx.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, f.run.id))).toEqual(before);
      throw SOURCE_ROLLBACK;
    })).rejects.toBe(SOURCE_ROLLBACK);
  });
});
