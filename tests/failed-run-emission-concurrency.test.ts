import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { updateFeedstockInTransaction } from "@/data-access/feedstocks";
import { createCreditBatchInTransaction } from "@/data-access/credit-batches";
import { withFailedRunLineage, FAILED_END } from "./helpers/failed-run-lineage-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { updateFacility } from "@/data-access/facility-mutations";
import { updateFeedstockType } from "@/data-access/feedstock-types";
import { prepareFeedstockTransportOwnershipFreeze } from "@/data-access/feedstock-transport-ownership-freeze";
import { getFeedstockTransportOwners } from "@/data-access/feedstock-transport-ownership";
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { activityEvents, certificationSubmissions, certifierRemovals, creditBatches, facilities, feedstocks, feedstockTypes,
  productionProcesses, productionRunFeedstocks, productionRuns, reactors, storageLocations, suppliers } from "@/db/schema";
import { updateProductionRun, deleteProductionRun } from "@/data-access/production-runs";
import { prepareFailedRunEmissionWrite } from "@/data-access/failed-run-emission-write-guard";
import { lockProductionProcessScope } from "@/data-access/production-processes";
import { loadProductionSourceManifest } from "@/data-access/production-source-manifest";
import { reserveProductionEmissionsClaims } from "@/data-access/production-claim-reservations";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { failedRunFixture } from "./helpers/failed-run-fixture";
import { insertRemovalFixture } from "./helpers/removal-fixture";

const TEST_TIMEOUT_MS = 20_000;
const BARRIER_TIMEOUT_MS = 5_000;
const ctx = makeTestOrgContext();
const ROLLBACK = new Error("rollback lock holder");
beforeAll(() => ensureTestOrg());

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const f = await db.transaction(tx => failedRunFixture(tx));
  const [removal] = await insertRemovalFixture(db, { ...f.site });
  const [submission] = await db.insert(certificationSubmissions).values({
    ...f.org, provider: "isometric", submissionType: "removal", localEntityType: "removal",
    localEntityId: removal.id, status: "draft", version: 1, lockedAt: new Date(),
    payloadHash: `failed-race-${crypto.randomUUID()}`,
  }).returning();
  return { ...f, removal, submission, cleanup: async () => {
    await db.delete(creditBatches).where(eq(creditBatches.id, f.batch!.id));
    await db.delete(certificationSubmissions).where(eq(certificationSubmissions.id, submission.id));
    await db.delete(certifierRemovals).where(eq(certifierRemovals.id, removal.id));
    await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, f.run.id));
    await db.delete(productionRuns).where(eq(productionRuns.id, f.run.id));
    await db.delete(feedstocks).where(eq(feedstocks.id, f.stock.id));
    await db.delete(storageLocations).where(eq(storageLocations.id, f.stock.storageLocationId!));
    await db.delete(reactors).where(eq(reactors.id, f.run.reactorId!));
    await db.delete(productionProcesses).where(eq(productionProcesses.facilityId, f.facility.id));
    await db.delete(facilities).where(eq(facilities.id, f.facility.id));
    await db.delete(feedstockTypes).where(eq(feedstockTypes.id, f.type.id));
    await db.delete(suppliers).where(eq(suppliers.id, f.stock.supplierId!));
  } };
}

async function lockWriter(tx: DbTransaction, f: Awaited<ReturnType<typeof fixture>>) {
  await tx.select().from(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, f.facility.id))).for("share");
  await tx.select().from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, f.run.id))).for("update");
  return prepareFailedRunEmissionWrite(ctx, tx, f.run.id);
}

describe("failed emission writer serialization", () => {
  it.each([
    ["cohort declaration", "edit"], ["batch reservation", "edit"], ["batch reservation", "delete"],
  ])("refuses a late lock held by %s during %s without a partial source change", async (kind, action) => {
    const f = await fixture();
    const ready = barrier();
    const release = barrier();
    let blockerPid = 0;
    const blocker = db.transaction(async tx => {
      if (kind === "cohort declaration") await lockProductionProcessScope(tx, f.batchValues);
      else await tx.select().from(creditBatches).where(eq(creditBatches.id, f.batch!.id)).for("update");
      blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
      ready.resolve();
      await release.promise;
      throw ROLLBACK;
    }).catch(error => { if (error !== ROLLBACK) throw error; });
    let writer: Promise<unknown> | undefined;
    try {
      await Promise.race([ready.promise, blocker]);
      writer = action === "delete" ? deleteProductionRun(ctx, f.run.id, f.run.version) : db.transaction(async tx => {
        const pid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
        expect(pid).not.toBe(blockerPid);
        const finish = await lockWriter(tx, f);
        await tx.update(productionRuns).set({ dieselOperationLiters: 99 }).where(eq(productionRuns.id, f.run.id));
        await finish();
      });
      let settled = false;
      void writer.then(() => { settled = true; }, () => { settled = true; });
      await expect.poll(() => settled, { timeout: BARRIER_TIMEOUT_MS }).toBe(true);
      await expect(writer).rejects.toMatchObject({ code: "conflict" });
      expect((await db.select().from(productionRuns).where(eq(productionRuns.id, f.run.id)))[0].dieselOperationLiters).toBe(f.run.dieselOperationLiters);
    } finally {
      release.resolve();
      await blocker;
      await writer?.catch(() => undefined);
      await f.cleanup();
    }
  }, TEST_TIMEOUT_MS);

  it("rejects the reviewed manifest when a failed writer wins the batch row first", async () => {
    const f = await fixture();
    const reviewed = await loadProductionSourceManifest(ctx, [f.batch!.id]);
    const ready = barrier();
    const release = barrier();
    let writerPid = 0;
    const writer = db.transaction(async tx => {
      const finish = await lockWriter(tx, f);
      await tx.update(productionRuns).set({ version: f.run.version + 1 }).where(eq(productionRuns.id, f.run.id));
      await finish();
      writerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
      ready.resolve();
      await release.promise;
    });
    let reservation: Promise<void> | undefined;
    try {
      await Promise.race([ready.promise, writer]);
      reservation = reserveProductionEmissionsClaims(ctx, {
        removalId: f.removal.id, submissionId: f.submission.id, creditBatchIds: [f.batch!.id],
        frozenProductionSourceManifest: reviewed,
      });
      void reservation.catch(() => undefined);
      await expect.poll(async () => (await db.execute<{ waiting: boolean }>(sql`
        select exists (select 1 from pg_stat_activity
          where ${writerPid} = any(pg_blocking_pids(pid)) and query ilike '%credit_batches%') as waiting
      `)).rows[0].waiting, { timeout: BARRIER_TIMEOUT_MS }).toBe(true);
      release.resolve();
      await writer;
      await expect(reservation).rejects.toMatchObject({ code: "conflict" });
      expect((await db.select().from(creditBatches).where(eq(creditBatches.id, f.batch!.id)))[0].productionEmissionsClaimReservedBySubmissionId).toBeNull();
    } finally {
      release.resolve();
      await writer.catch(() => undefined);
      await reservation?.catch(() => undefined);
      await f.cleanup();
    }
  }, TEST_TIMEOUT_MS);
});


it.each(["edit", "delete"] as const)("a committed reservation wins before public failed-run %s", async action => {
  await withFailedRunLineage(async (f, run) => {
    const [submission] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId,
      provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: f.removalId,
      status: "draft", version: 1, lockedAt: new Date(), payloadHash: `reserved-${crypto.randomUUID()}` }).returning();
    await reserveProductionEmissionsClaims(ctx, { removalId: f.removalId, submissionId: submission.id,
      creditBatchIds: [f.batchId], frozenProductionSourceManifest: await loadProductionSourceManifest(ctx, [f.batchId]) });
    const write = action === "edit"
      ? updateProductionRun(ctx, run.id, { expectedVersion: run.version, electricityKwh: 9 })
      : deleteProductionRun(ctx, run.id, run.version);
    await expect(write).rejects.toMatchObject({ code: "certification_locked" });
    expect((await db.select().from(productionRuns).where(eq(productionRuns.id, run.id)))[0]).toMatchObject({
      version: run.version, electricityKwh: run.electricityKwh,
    });
    expect((await db.select().from(creditBatches).where(eq(creditBatches.id, f.batchId)))[0].productionEmissionsClaimReservedBySubmissionId).toBe(submission.id);
  }, "none");
}, TEST_TIMEOUT_MS);

it("Running to Failed refuses a concurrent sender's artifact without committing the outcome", async () => {
  await withFailedRunLineage(async (f, run) => {
    await db.update(productionRuns).set({ status: "running", endTime: null }).where(eq(productionRuns.id, run.id));
    const hold = await openOperationBarrier(db.$client);
    try {
      await acquireCertificationArtifactLocksSorted(hold.tx, [{ provider: "isometric", localEntityType: "removal", localEntityId: f.removalId }]);
      await expect(updateProductionRun(ctx, run.id, { expectedVersion: run.version, status: "failed", endTime: FAILED_END }))
        .rejects.toMatchObject({ code: "conflict", retryable: true });
      const [saved] = await db.select().from(productionRuns).where(eq(productionRuns.id, run.id));
      expect(saved).toMatchObject({ status: "running", endTime: null, version: run.version });
    } finally { await hold.rollback(); }
  }, "none");
}, TEST_TIMEOUT_MS);

it.each(["timezone", "type"] as const)("%s edits discover failed-source sender artifacts without waiting out of order", async field => {
  await withFailedRunLineage(async f => {
    await db.update(feedstockTypes).set({ isometricFeedstockTypeId: "old-link" }).where(eq(feedstockTypes.id, f.feedstockTypeId));
    const [facility] = await db.select().from(facilities).where(eq(facilities.id, f.facilityId));
    const [type] = await db.select().from(feedstockTypes).where(eq(feedstockTypes.id, f.feedstockTypeId));
    const hold = await openOperationBarrier(db.$client);
    try {
      await acquireCertificationArtifactLocksSorted(hold.tx, [{ provider: "isometric", localEntityType: "removal", localEntityId: f.removalId }]);
      const write = field === "timezone"
        ? updateFacility(ctx, f.facilityId, { expectedVersion: facility.version, timezone: "Africa/Dar_es_Salaam" })
        : updateFeedstockType(ctx, { feedstockTypeId: f.feedstockTypeId, expectedVersion: type.version, isometricFeedstockTypeId: "new-link" });
      await expect(write).rejects.toMatchObject({ code: "conflict", retryable: true });
      expect((await db.select().from(facilities).where(eq(facilities.id, f.facilityId)))[0].timezone).toBe(facility.timezone);
      expect((await db.select().from(feedstockTypes).where(eq(feedstockTypes.id, f.feedstockTypeId)))[0].isometricFeedstockTypeId).toBe("old-link");
    } finally { await hold.rollback(); }
  }, "none");
}, TEST_TIMEOUT_MS);

it("serializes competing failed transport owner changes across facilities before comparing owners", async () => {
  const a = await fixture();
  const b = await fixture();
  const hold = await openOperationBarrier(db.$client);
  let competing: Promise<void> | undefined;
  try {
    await db.update(productionRuns).set({ startTime: new Date("2026-02-27T12:00:00Z") }).where(eq(productionRuns.id, a.run.id));
    await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, b.run.id));
    await db.insert(productionRunFeedstocks).values({ organizationId: ctx.organizationId, productionRunId: b.run.id,
      feedstockId: a.stock.id, wetMassUsedKg: 100 });
    const [process] = await db.insert(productionProcesses).values({ organizationId: ctx.organizationId,
      facilityId: b.facility.id, feedstockTypeId: a.type.id }).returning();
    await db.update(creditBatches).set({ feedstockTypeId: a.type.id, productionProcessId: process.id })
      .where(eq(creditBatches.id, b.batch!.id));
    const owners = () => getFeedstockTransportOwners(ctx, [a.stock.id]);
    expect((await owners()).get(a.stock.id)).toBe(a.run.id);
    const freeze = await prepareFeedstockTransportOwnershipFreeze(ctx, hold.tx, [a.stock.id], { mutation: "update", subject: "production run" });
    await freeze(async () => {
      await hold.tx.update(productionRuns).set({ startTime: new Date("2026-02-28T13:00:00Z") }).where(eq(productionRuns.id, a.run.id));
    });
    competing = db.transaction(async tx => {
      const second = await prepareFeedstockTransportOwnershipFreeze(ctx, tx, [a.stock.id], { mutation: "update", subject: "production run" });
      await second(async () => {
        await tx.update(productionRuns).set({ startTime: new Date("2026-02-28T14:00:00Z") }).where(eq(productionRuns.id, b.run.id));
      });
    });
    void competing.catch(() => undefined);
    await waitForBlockedOperations(db.$client, hold.pid, 1);
    await hold.commit();
    await competing;
    expect((await owners()).get(a.stock.id)).toBe(a.run.id);
  } finally {
    await hold.rollback();
    await competing?.catch(() => undefined);
    await b.cleanup();
    await a.cleanup();
  }
}, TEST_TIMEOUT_MS);


it("batch declaration discovers a newly failed source after waiting for its process scope", async () => {
  const f = await fixture();
  await db.delete(creditBatches).where(eq(creditBatches.id, f.batch!.id));
  await db.update(productionRuns).set({ status: "running", endTime: null }).where(eq(productionRuns.id, f.run.id));
  const hold = await openOperationBarrier(db.$client);
  let declaration: ReturnType<typeof createCreditBatchInTransaction> | undefined;
  let createdBatchId: string | undefined;
  try {
    await hold.tx.select().from(facilities).where(eq(facilities.id, f.facility.id)).for("share");
    await hold.tx.select().from(productionRuns).where(eq(productionRuns.id, f.run.id)).for("update");
    const finish = await prepareFailedRunEmissionWrite(ctx, hold.tx, f.run.id, { status: "failed" });
    await hold.tx.update(productionRuns).set({ status: "failed", endTime: f.run.endTime,
      version: f.run.version + 1 }).where(eq(productionRuns.id, f.run.id));
    await finish();
    declaration = db.transaction(tx => createCreditBatchInTransaction(ctx, tx, {
      code: `FR-DECLARED-${crypto.randomUUID()}`, facilityId: f.facility.id, feedstockTypeId: f.type.id,
      startDate: new Date(f.batchValues.startDate), endDate: new Date(f.batchValues.endDate), productionRunIds: [],
    }, "form"));
    void declaration.catch(() => undefined);
    await waitForBlockedOperations(db.$client, hold.pid, 1);
    await hold.commit();
    const saved = await declaration;
    createdBatchId = saved.batch.id;
    expect(saved.memberProductionRunIds).toEqual([]);
    const manifest = await loadProductionSourceManifest(ctx, [saved.batch.id]);
    expect(manifest.failedContributors.map(run => run.runId)).toEqual([f.run.id]);
    expect(manifest.failedContributors[0].version).toBe(f.run.version + 1);
  } finally {
    await hold.rollback();
    const saved = await declaration?.catch(() => undefined);
    createdBatchId ??= saved?.batch.id;
    if (createdBatchId) {
      await db.delete(activityEvents).where(eq(activityEvents.creditBatchId, createdBatchId));
      await db.delete(creditBatches).where(eq(creditBatches.id, createdBatchId));
    }
    await f.cleanup();
  }
}, TEST_TIMEOUT_MS);


it("allows a note-only intake edit while its complete-only run is locked", async () => {
  await withLineageFixture(async f => {
    await db.update(productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z"),
      outputPostedAt: new Date("2026-06-13T12:00:00Z") }).where(eq(productionRuns.id, f.productionRunId));
    const [stock] = await db.select().from(feedstocks).where(eq(feedstocks.id, f.feedstockId));
    const hold = await openOperationBarrier(db.$client);
    try {
      await hold.tx.select().from(productionRuns).where(eq(productionRuns.id, f.productionRunId)).for("update");
      await db.transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        const saved = await updateFeedstockInTransaction(ctx, tx, stock.id, {
          expectedVersion: stock.version, notes: "Updated intake note",
        });
        expect(saved.notes).toBe("Updated intake note");
        throw ROLLBACK;
      }).catch(error => { if (error !== ROLLBACK) throw error; });
    } finally { await hold.rollback(); }
  }, "none");
}, TEST_TIMEOUT_MS);
