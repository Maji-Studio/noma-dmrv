import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  creditBatches,
  creditBatchProductionRuns,
  certifierRemovals,
  facilities,
  feedstocks,
  feedstockTypes,
  productionProcesses,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  storageLocations,
} from "@/db/schema";
import {
  attachProductionRunToMatchingCreditBatch,
} from "@/data-access/credit-batch-membership";
import {
  createCreditBatch,
  updateCreditBatch,
} from "@/data-access/credit-batches";
import {
  createProductionRun,
  updateProductionRun,
} from "@/data-access/production-runs";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-credit-batch-auto-membership";
const CONCURRENCY_BARRIER_TIMEOUT_MS = 5_000;

describe("credit batch automatic production-run membership", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const ctx = makeTestOrgContext(TEST_USER_ID);
  let facilityId = "";
  let reactorId = "";
  let feedstockTypeId = "";
  let storageLocationId = "";
  let feedstockId = "";
  let alternateFeedstockTypeId = "";
  let alternateFeedstockId = "";
  const creditBatchIds: string[] = [];
  const removalIds: string[] = [];
  const productionRunIds: string[] = [];

  beforeAll(async () => {
    await ensureTestOrg();

    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-CBAM-${tag}`,
        name: `CB auto-membership facility ${tag}`,
      })
      .returning({ id: facilities.id });
    facilityId = facility.id;

    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        code: `RE-CBAM-${tag}`,
        identifier: `CB auto-membership reactor ${tag}`,
        facilityId,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    reactorId = reactor.id;

    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-CBAM-${tag}`,
        name: `CB auto-membership feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    feedstockTypeId = feedstockType.id;

    const [storageLocation] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BIN-CBAM-${tag}`,
        name: `CB auto-membership bin ${tag}`,
        type: "feedstock_bin",
        facilityId,
        feedstockTypeId,
      })
      .returning({ id: storageLocations.id });
    storageLocationId = storageLocation.id;

    const [feedstock] = await db
      .insert(feedstocks)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FS-CBAM-${tag}`,
        facilityId,
        status: "complete",
        feedstockTypeId,
        massDryKg: 2_000,
        massWetKg: 2_500,
        moistureContentPercent: 20,
        storageLocationId,
      })
      .returning({ id: feedstocks.id });
    feedstockId = feedstock.id;

    const [alternateFeedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-CBAM-ALT-${tag}`,
        name: `CB auto-membership alternate feedstock ${tag}`,
        category: "agricultural",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    alternateFeedstockTypeId = alternateFeedstockType.id;

    const [alternateFeedstock] = await db
      .insert(feedstocks)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FS-CBAM-ALT-${tag}`,
        facilityId,
        status: "complete",
        feedstockTypeId: alternateFeedstockTypeId,
        massDryKg: 100,
        massWetKg: 125,
        moistureContentPercent: 20,
      })
      .returning({ id: feedstocks.id });
    alternateFeedstockId = alternateFeedstock.id;
  });

  afterAll(async () => {
    if (productionRunIds.length > 0) {
      await db
        .delete(creditBatchProductionRuns)
        .where(
          inArray(
            creditBatchProductionRuns.productionRunId,
            productionRunIds,
          ),
        );
      await db
        .delete(productionRunFeedstocks)
        .where(
          inArray(productionRunFeedstocks.productionRunId, productionRunIds),
        );
      await db
        .delete(productionRuns)
        .where(inArray(productionRuns.id, productionRunIds));
    }
    if (creditBatchIds.length > 0) {
      await db
        .delete(creditBatches)
        .where(inArray(creditBatches.id, creditBatchIds));
    }
    if (removalIds.length > 0) {
      await db
        .delete(certifierRemovals)
        .where(inArray(certifierRemovals.id, removalIds));
    }
    if (facilityId) {
      await db
        .delete(productionProcesses)
        .where(eq(productionProcesses.facilityId, facilityId));
    }
    if (feedstockId) {
      await db.delete(feedstocks).where(eq(feedstocks.id, feedstockId));
    }
    if (alternateFeedstockId) {
      await db
        .delete(feedstocks)
        .where(eq(feedstocks.id, alternateFeedstockId));
    }
    if (storageLocationId) {
      await db
        .delete(storageLocations)
        .where(eq(storageLocations.id, storageLocationId));
    }
    if (reactorId) {
      await db.delete(reactors).where(eq(reactors.id, reactorId));
    }
    if (facilityId) {
      await db.delete(facilities).where(eq(facilities.id, facilityId));
    }
    if (feedstockTypeId) {
      await db
        .delete(feedstockTypes)
        .where(eq(feedstockTypes.id, feedstockTypeId));
    }
    if (alternateFeedstockTypeId) {
      await db
        .delete(feedstockTypes)
        .where(eq(feedstockTypes.id, alternateFeedstockTypeId));
    }
  });

  it("creates an empty batch and attaches a matching run when it completes", async () => {
    const batch = await createCreditBatch(ctx, {
      code: `CB-CBAM-${tag}`,
      facilityId,
      feedstockTypeId,
      startDate: new Date("2027-02-01T00:00:00.000Z"),
      endDate: new Date("2027-02-28T00:00:00.000Z"),
      productionRunIds: [],
      currency: "TZS",
    });
    creditBatchIds.push(batch.id);
    expect(batch.productionRunIds).toEqual([]);

    const running = await createProductionRun(ctx, {
      code: `PR-CBAM-${tag}`,
      facilityId,
      reactorId,
      status: "running",
      startTime: new Date("2027-02-15T08:00:00.000Z"),
      endTime: null,
      feedstockWetMassKg: 100,
      feedstockMoisturePercent: 20,
      feedstockStorageLocationId: storageLocationId,
    });
    productionRunIds.push(running.id);

    await updateProductionRun(ctx, running.id, {
      status: "complete",
      endTime: new Date("2027-02-15T12:00:00.000Z"),
      biocharOutputKg: 30,
      biocharMoisturePercent: 20,
    });

    const [membership] = await db
      .select({
        creditBatchId: creditBatchProductionRuns.creditBatchId,
      })
      .from(creditBatchProductionRuns)
      .where(
        eq(creditBatchProductionRuns.productionRunId, running.id),
      );
    expect(membership?.creditBatchId).toBe(batch.id);
  });

  it("attaches existing matching completed runs when the batch is created", async () => {
    const running = await createProductionRun(ctx, {
      code: `PR-CBAM-EXISTING-${tag}`,
      facilityId,
      reactorId,
      status: "running",
      startTime: new Date("2027-03-15T08:00:00.000Z"),
      endTime: null,
      feedstockWetMassKg: 100,
      feedstockMoisturePercent: 20,
      feedstockStorageLocationId: storageLocationId,
    });
    productionRunIds.push(running.id);
    await updateProductionRun(ctx, running.id, {
      status: "complete",
      endTime: new Date("2027-03-15T12:00:00.000Z"),
      biocharOutputKg: 30,
      biocharMoisturePercent: 20,
    });

    const batch = await createCreditBatch(ctx, {
      code: `CB-CBAM-EXISTING-${tag}`,
      facilityId,
      feedstockTypeId,
      startDate: new Date("2027-03-01T00:00:00.000Z"),
      endDate: new Date("2027-03-31T00:00:00.000Z"),
      productionRunIds: [],
      currency: "TZS",
    });
    creditBatchIds.push(batch.id);

    expect(batch.productionRunIds).toEqual([running.id]);
  });

  it("includes every existing match when create submits only a subset", async () => {
    const first = await createProductionRun(ctx, {
      code: `PR-CBAM-SUBSET-A-${tag}`,
      facilityId,
      reactorId,
      status: "running",
      startTime: new Date("2027-05-10T08:00:00.000Z"),
      endTime: null,
      feedstockWetMassKg: 100,
      feedstockMoisturePercent: 20,
      feedstockStorageLocationId: storageLocationId,
    });
    const second = await createProductionRun(ctx, {
      code: `PR-CBAM-SUBSET-B-${tag}`,
      facilityId,
      reactorId,
      status: "running",
      startTime: new Date("2027-05-11T08:00:00.000Z"),
      endTime: null,
      feedstockWetMassKg: 100,
      feedstockMoisturePercent: 20,
      feedstockStorageLocationId: storageLocationId,
    });
    productionRunIds.push(first.id, second.id);
    await updateProductionRun(ctx, first.id, {
      status: "complete",
      endTime: new Date("2027-05-10T12:00:00.000Z"),
      biocharOutputKg: 30,
      biocharMoisturePercent: 20,
    });
    await updateProductionRun(ctx, second.id, {
      status: "complete",
      endTime: new Date("2027-05-11T12:00:00.000Z"),
      biocharOutputKg: 30,
      biocharMoisturePercent: 20,
    });

    const batch = await createCreditBatch(ctx, {
      code: `CB-CBAM-SUBSET-${tag}`,
      facilityId,
      feedstockTypeId,
      startDate: new Date("2027-05-01T00:00:00.000Z"),
      endDate: new Date("2027-05-31T00:00:00.000Z"),
      productionRunIds: [first.id],
      currency: "TZS",
    });
    creditBatchIds.push(batch.id);

    expect(batch.productionRunIds.sort()).toEqual([first.id, second.id].sort());
  });

  it("updates a declared batch while it still has no production runs", async () => {
    const batch = await createCreditBatch(ctx, {
      code: `CB-CBAM-EMPTY-${tag}`,
      facilityId,
      feedstockTypeId,
      startDate: new Date("2027-04-01T00:00:00.000Z"),
      endDate: new Date("2027-04-30T00:00:00.000Z"),
      productionRunIds: [],
      currency: "TZS",
    });
    creditBatchIds.push(batch.id);

    const updated = await updateCreditBatch(ctx, batch.id, {
      productionRunIds: [],
      siteManagementNotes: "Declared before production",
    });

    expect(updated.productionRunIds).toEqual([]);
    expect(updated.siteManagementNotes).toBe("Declared before production");
  });

  it("skips automatic attachment for empty and mixed feedstock sets", async () => {
    const emptyFeedstockRun = await createProductionRun(ctx, {
      code: `PR-CBAM-EMPTY-FS-${tag}`,
      facilityId,
      reactorId,
      status: "running",
      startTime: new Date("2027-07-10T08:00:00.000Z"),
      endTime: null,
      feedstockWetMassKg: 100,
      feedstockMoisturePercent: 20,
      feedstockStorageLocationId: storageLocationId,
    });
    const mixedFeedstockRun = await createProductionRun(ctx, {
      code: `PR-CBAM-MIXED-FS-${tag}`,
      facilityId,
      reactorId,
      status: "running",
      startTime: new Date("2027-07-11T08:00:00.000Z"),
      endTime: null,
      feedstockWetMassKg: 100,
      feedstockMoisturePercent: 20,
      feedstockStorageLocationId: storageLocationId,
    });
    productionRunIds.push(emptyFeedstockRun.id, mixedFeedstockRun.id);
    await updateProductionRun(ctx, emptyFeedstockRun.id, {
      status: "complete",
      endTime: new Date("2027-07-10T12:00:00.000Z"),
      biocharOutputKg: 30,
      biocharMoisturePercent: 20,
    });
    await updateProductionRun(ctx, mixedFeedstockRun.id, {
      status: "complete",
      endTime: new Date("2027-07-11T12:00:00.000Z"),
      biocharOutputKg: 30,
      biocharMoisturePercent: 20,
    });

    await db
      .delete(productionRunFeedstocks)
      .where(eq(productionRunFeedstocks.productionRunId, emptyFeedstockRun.id));
    await db.insert(productionRunFeedstocks).values({
      organizationId: TEST_ORG_ID,
      productionRunId: mixedFeedstockRun.id,
      feedstockId: alternateFeedstockId,
      massUsedKg: 1,
    });

    await expect(
      db.transaction((tx) =>
        attachProductionRunToMatchingCreditBatch(
          ctx,
          tx,
          emptyFeedstockRun.id,
        ),
      ),
    ).resolves.toBeNull();
    await expect(
      db.transaction((tx) =>
        attachProductionRunToMatchingCreditBatch(
          ctx,
          tx,
          mixedFeedstockRun.id,
        ),
      ),
    ).resolves.toBeNull();
  });

  it("rejects overlapping cohorts on create and update", async () => {
    const first = await createCreditBatch(ctx, {
      code: `CB-CBAM-OVERLAP-A-${tag}`,
      facilityId,
      feedstockTypeId,
      startDate: new Date("2027-08-01T00:00:00.000Z"),
      endDate: new Date("2027-08-10T00:00:00.000Z"),
      productionRunIds: [],
      currency: "TZS",
    });
    const second = await createCreditBatch(ctx, {
      code: `CB-CBAM-OVERLAP-B-${tag}`,
      facilityId,
      feedstockTypeId,
      startDate: new Date("2027-08-20T00:00:00.000Z"),
      endDate: new Date("2027-08-31T00:00:00.000Z"),
      productionRunIds: [],
      currency: "TZS",
    });
    creditBatchIds.push(first.id, second.id);

    await expect(
      createCreditBatch(ctx, {
        code: `CB-CBAM-OVERLAP-C-${tag}`,
        facilityId,
        feedstockTypeId,
        startDate: new Date("2027-08-05T00:00:00.000Z"),
        endDate: new Date("2027-08-15T00:00:00.000Z"),
        productionRunIds: [],
        currency: "TZS",
      }),
    ).rejects.toThrow(/overlaps Credit batch/);

    await expect(
      updateCreditBatch(ctx, second.id, {
        startDate: new Date("2027-08-10T00:00:00.000Z"),
      }),
    ).rejects.toThrow(/overlaps Credit batch/);
  });

  it("auto-attaches to a mutable Removal's credit batch", async () => {
    const batch = await createCreditBatch(ctx, {
      code: `CB-CBAM-REMOVAL-${tag}`,
      facilityId,
      feedstockTypeId,
      startDate: new Date("2027-09-01T00:00:00.000Z"),
      endDate: new Date("2027-09-30T00:00:00.000Z"),
      productionRunIds: [],
      currency: "TZS",
    });
    creditBatchIds.push(batch.id);
    const [removal] = await db
      .insert(certifierRemovals)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId,
      })
      .returning({ id: certifierRemovals.id });
    removalIds.push(removal.id);
    await db
      .update(creditBatches)
      .set({ removalId: removal.id })
      .where(eq(creditBatches.id, batch.id));

    const run = await createProductionRun(ctx, {
      code: `PR-CBAM-REMOVAL-${tag}`,
      facilityId,
      reactorId,
      status: "running",
      startTime: new Date("2027-09-15T08:00:00.000Z"),
      endTime: null,
      feedstockWetMassKg: 100,
      feedstockMoisturePercent: 20,
      feedstockStorageLocationId: storageLocationId,
    });
    productionRunIds.push(run.id);

    await expect(
      updateProductionRun(ctx, run.id, {
        status: "complete",
        endTime: new Date("2027-09-15T12:00:00.000Z"),
        biocharOutputKg: 30,
        biocharMoisturePercent: 20,
      }),
    ).resolves.toBeDefined();

    const [membership] = await db
      .select({ creditBatchId: creditBatchProductionRuns.creditBatchId })
      .from(creditBatchProductionRuns)
      .where(eq(creditBatchProductionRuns.productionRunId, run.id));
    expect(membership?.creditBatchId).toBe(batch.id);
  });

  it("never loses membership when completion races batch declaration", async () => {
    const running = await createProductionRun(ctx, {
      code: `PR-CBAM-RACE-${tag}`,
      facilityId,
      reactorId,
      status: "running",
      startTime: new Date("2027-06-15T08:00:00.000Z"),
      endTime: null,
      feedstockWetMassKg: 100,
      feedstockMoisturePercent: 20,
      feedstockStorageLocationId: storageLocationId,
    });
    productionRunIds.push(running.id);

    const lockKey =
      `production-process-current:${facilityId}:${feedstockTypeId}`;
    let releaseScopeLock = () => {};
    let signalScopeLockReady = () => {};
    const scopeLockReady = new Promise<void>((resolve) => {
      signalScopeLockReady = resolve;
    });
    const releaseScopeLockPromise = new Promise<void>((resolve) => {
      releaseScopeLock = resolve;
    });
    let blockerPid = 0;
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `);
      const backend = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      );
      blockerPid = backend.rows[0]?.pid ?? 0;
      signalScopeLockReady();
      await releaseScopeLockPromise;
    });

    const batchCode = `CB-CBAM-RACE-${tag}`;
    let completionPromise: ReturnType<typeof updateProductionRun> | undefined;
    let createPromise: ReturnType<typeof createCreditBatch> | undefined;
    try {
      await scopeLockReady;
      completionPromise = updateProductionRun(ctx, running.id, {
        status: "complete",
        endTime: new Date("2027-06-15T12:00:00.000Z"),
        biocharOutputKg: 30,
        biocharMoisturePercent: 20,
      });
      void completionPromise.catch(() => undefined);

      await expect.poll(async () => {
        const result = await db.execute<{ waiting: boolean }>(sql`
          select exists (
            select 1
            from pg_locks waiting
            join pg_locks held
              on held.locktype = waiting.locktype
             and held.database is not distinct from waiting.database
             and held.classid is not distinct from waiting.classid
             and held.objid is not distinct from waiting.objid
             and held.objsubid is not distinct from waiting.objsubid
            where waiting.locktype = 'advisory'
              and not waiting.granted
              and held.granted
              and held.pid = ${blockerPid}
          ) as waiting
        `);
        return result.rows[0]?.waiting ?? false;
      }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(true);

      createPromise = createCreditBatch(ctx, {
        code: batchCode,
        facilityId,
        feedstockTypeId,
        startDate: new Date("2027-06-01T00:00:00.000Z"),
        endDate: new Date("2027-06-30T00:00:00.000Z"),
        productionRunIds: [],
        currency: "TZS",
      });
      void createPromise.catch(() => undefined);
      await expect.poll(async () => {
        const result = await db.execute<{ waiterCount: number }>(sql`
          select count(distinct waiting.pid)::int as "waiterCount"
          from pg_locks waiting
          join pg_locks held
            on held.locktype = waiting.locktype
           and held.database is not distinct from waiting.database
           and held.classid is not distinct from waiting.classid
           and held.objid is not distinct from waiting.objid
           and held.objsubid is not distinct from waiting.objsubid
          where waiting.locktype = 'advisory'
            and not waiting.granted
            and held.granted
            and held.pid = ${blockerPid}
        `);
        return result.rows[0]?.waiterCount ?? 0;
      }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(2);
      releaseScopeLock();
      await blocker;

      const [completionResult, createResult] = await Promise.allSettled([
        completionPromise,
        createPromise,
      ]);
      expect(completionResult.status).toBe("fulfilled");
      expect(createResult.status).toBe("fulfilled");
      if (createResult.status !== "fulfilled") {
        throw createResult.reason;
      }
      const batch = createResult.value;
      creditBatchIds.push(batch.id);

      const [membership] = await db
        .select({ creditBatchId: creditBatchProductionRuns.creditBatchId })
        .from(creditBatchProductionRuns)
        .where(eq(creditBatchProductionRuns.productionRunId, running.id));
      expect(membership?.creditBatchId).toBe(batch.id);
    } finally {
      releaseScopeLock();
      await blocker.catch(() => undefined);
      await completionPromise?.catch(() => undefined);
      await createPromise?.catch(() => undefined);
    }
  });
});
