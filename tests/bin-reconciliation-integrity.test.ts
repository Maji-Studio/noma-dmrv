import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  binMovements,
  facilities,
  feedstocks,
  feedstockTypes,
  productionRunFeedstockDraws,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  storageLocations,
  users,
} from "@/db/schema";
import { getStorageLocationWithFacility } from "@/data-access/storage-locations";
import { lockBinStock } from "@/data-access/bin-stock-guards";
import {
  createBiocharProduct,
  deleteBiocharProduct,
} from "@/data-access/biochar-products";
import { createDelivery } from "@/data-access/deliveries";
import { updateOrder } from "@/data-access/orders";
import { createProductionRun } from "@/data-access/production-runs";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-bin-reconciliation";
const INITIAL_FEEDSTOCK_DRY_MASS_KG = 100;
const RECOUNTED_FEEDSTOCK_WET_MASS_KG = 10;
const CONCURRENCY_BARRIER_TIMEOUT_MS = 5_000;
/**
 * These tests park real transactions on real locks, so a barrier poll can burn
 * the whole budget on its own — vitest's 5s default leaves nothing for the DB
 * setup, the racing transactions and the cleanup around it. Give the suite room
 * so a slow CI runner reports a genuine failure instead of a timeout.
 */
const CONCURRENCY_TEST_TIMEOUT_MS = 30_000;

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return {
    ...actual,
    requireOrgContext: vi.fn().mockResolvedValue({
      userId: "test-user-bin-reconciliation",
      organizationId: "org_test_fixtures",
      orgRole: "owner",
      isPlatformAdmin: false,
    }),
  };
});

import { recordStockTakeFn } from "@/fn/bin-movements";

beforeAll(async () => {
  await ensureTestOrg();
  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      email: "bin-reconciliation-test@example.com",
      name: "Bin Reconciliation Test",
      emailVerified: true,
    })
    .onConflictDoNothing({ target: users.id });
});

import { postedStockFixture, cleanupPostedStock, productInput, postProduct, postDelivery, deliveryInput, postMeasurement } from "./helpers/posted-output-stock-fixture";
import { getOutputBinDryBalance } from "@/data-access/output-stock";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { postOutputStock } from "@/data-access/output-stock-post";
import { recordStockTakeMovement } from "@/data-access/bin-movements";
import { outputStockAllocations } from "@/db/schema";
const postedFixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
async function postedFixture(stockKg = 100) { const f = await postedStockFixture({ stockKg, quantityKg: 100 }); postedFixtures.push(f); return f; }
afterEach(async () => { for (const f of postedFixtures.splice(0)) await cleanupPostedStock(f); });

describe("bin reconciliation integrity", { timeout: CONCURRENCY_TEST_TIMEOUT_MS }, () => {
  it("keeps posted ingredient withdrawals when product deletion races a stock-take", async () => {
    const f = await postedFixture(0);
    const [bin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
      code: `E2E-ING-${f.tag}`, name: `E2E Ingredient ${f.tag}`, type: "feedstock_bin", feedstockTypeId: f.ingredientType.id }).returning();
    await db.insert(feedstocks).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id, code: `E2E-FS-${f.tag}`,
      status: "complete", storageLocationId: bin.id, feedstockTypeId: f.ingredientType.id, massWetKg: 100, massDryKg: 100, moistureContentPercent: 0, deliveryDate: new Date("2026-09-01") });
    await db.update(storageLocations).set({ formulationId: f.recipe.id }).where(eq(storageLocations.id, f.bin.id));
    const product = await postProduct(f, { formulationId: f.recipe.id, massKg: 100, composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, storageLocationId: bin.id, massKg: 30 }] } });
    const [deletion, stockTake] = await Promise.allSettled([
      deleteBiocharProduct(f.ctx, product.id),
      recordStockTakeMovement(f.ctx, { storageLocationId: bin.id, lane: "feedstock", countedMassKg: 50, countedWetMassKg: 50, moistureRatioUsed: 0, reason: "E2E concurrent count" }),
    ]);
    expect(deletion.status).toBe("rejected"); expect(stockTake.status).toBe("fulfilled");
    expect((await getStorageLocationWithFacility(f.ctx, bin.id)).feedstockInventory.currentWetMassKg).toBe(50);
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(70);
  });

  it("serializes a stock-take against a concurrent production-run feedstock draw", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const runCode = `PR-TAKE-RUN-${tag}`;
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-TAKE-RUN-${tag}`,
        name: `Stock Take Run Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `R-TAKE-RUN-${tag}`,
        identifier: `Stock Take Run Reactor ${tag}`,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-TAKE-RUN-${tag}`,
        name: `Stock Take Run Feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        code: `BIN-TAKE-RUN-${tag}`,
        name: `Stock Take Run Bin ${tag}`,
        type: "feedstock_bin",
      })
      .returning({ id: storageLocations.id });
    const [feedstock] = await db
      .insert(feedstocks)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        storageLocationId: bin.id,
        code: `FS-TAKE-RUN-${tag}`,
        status: "complete",
        massDryKg: INITIAL_FEEDSTOCK_DRY_MASS_KG,
        massWetKg: INITIAL_FEEDSTOCK_DRY_MASS_KG,
        moistureContentPercent: 0,
      })
      .returning({ id: feedstocks.id });

    let releaseWriteBarrier = () => {};
    let writeBarrierTransaction: Promise<void> | undefined;
    let concurrentResults:
      | Promise<
          [
            PromiseSettledResult<Awaited<ReturnType<typeof recordStockTakeFn>>>,
            PromiseSettledResult<Awaited<ReturnType<typeof createProductionRun>>>,
          ]
        >
      | undefined;

    try {
      let signalWriteBarrierReady = () => {};
      const writeBarrierReady = new Promise<void>((resolve) => {
        signalWriteBarrierReady = resolve;
      });
      const releaseWriteBarrierPromise = new Promise<void>((resolve) => {
        releaseWriteBarrier = resolve;
      });
      writeBarrierTransaction = db.transaction(async (tx) => {
        await tx.execute(
          sql`lock table ${binMovements}, ${productionRunFeedstocks} in share mode`,
        );
        signalWriteBarrierReady();
        await releaseWriteBarrierPromise;
      });
      await writeBarrierReady;

      concurrentResults = Promise.allSettled([
        recordStockTakeFn({
          storageLocationId: bin.id,
          lane: "feedstock",
          countedMassKg: RECOUNTED_FEEDSTOCK_WET_MASS_KG,
          countedWetMassKg: RECOUNTED_FEEDSTOCK_WET_MASS_KG,
          moistureRatioUsed: 0,
          reason: "Concurrent stock-take against production run",
        }),
        createProductionRun(ctx, {
          code: runCode,
          facilityId: facility.id,
          reactorId: reactor.id,
          status: "running",
          startTime: new Date("2026-07-03T08:00:00Z"),
          endTime: null,
          feedstockWetMassKg: INITIAL_FEEDSTOCK_DRY_MASS_KG,
          feedstockMoisturePercent: 0,
          feedstockStorageLocationId: bin.id,
        }),
      ]);

      await expect
        .poll(
          async () => {
            const waitState = await db.execute<{ ready: boolean }>(sql`
              with blocked_writers as (
                select pid, relation
                from pg_locks
                where not granted
                  and mode = 'RowExclusiveLock'
                  and relation in (
                    'bin_movements'::regclass,
                    'production_run_feedstocks'::regclass
                  )
              )
              select
                (
                  (select count(distinct relation) from blocked_writers) = 2
                  or exists (
                    select 1
                    from pg_locks waiting
                    join pg_locks held
                      on held.locktype = waiting.locktype
                     and held.database is not distinct from waiting.database
                     and held.classid is not distinct from waiting.classid
                     and held.objid is not distinct from waiting.objid
                     and held.objsubid is not distinct from waiting.objsubid
                    join blocked_writers on blocked_writers.pid = held.pid
                    where waiting.locktype = 'advisory'
                      and not waiting.granted
                      and held.granted
                  )
                ) as ready
            `);
            return waitState.rows[0]?.ready ?? false;
          },
          { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS },
        )
        .toBe(true);

      releaseWriteBarrier();
      await writeBarrierTransaction;
      const [stockTakeResult, productionRunResult] = await concurrentResults;

      expect(stockTakeResult.status).toBe("fulfilled");
      let stockTakeSucceeded = false;
      if (stockTakeResult.status === "fulfilled") {
        stockTakeSucceeded = stockTakeResult.value.success;
        if (!stockTakeResult.value.success) {
          expect(stockTakeResult.value.field).toBe("countedMassKg");
        }
      }

      const runSucceeded = productionRunResult.status === "fulfilled";
      const runRejectedAsOverdraw =
        productionRunResult.status === "rejected" &&
        productionRunResult.reason instanceof Error &&
        productionRunResult.reason.message.includes(
          "Not enough wet feedstock in this bin",
        );
      expect(runSucceeded).not.toBe(runRejectedAsOverdraw);
      expect(stockTakeSucceeded).not.toBe(runSucceeded);

      const enriched = await getStorageLocationWithFacility(ctx, bin.id);
      expect(enriched.feedstockInventory.currentWetMassKg).toBe(
        stockTakeSucceeded ? RECOUNTED_FEEDSTOCK_WET_MASS_KG : 0,
      );
      expect(enriched.feedstockInventory.currentWetMassKg).toBeGreaterThanOrEqual(0);
    } finally {
      releaseWriteBarrier();
      await writeBarrierTransaction?.catch(() => undefined);
      await concurrentResults?.catch(() => undefined);
      await db
        .delete(productionRunFeedstocks)
        .where(eq(productionRunFeedstocks.feedstockId, feedstock.id));
      const runRows = await db
        .select({ id: productionRuns.id })
        .from(productionRuns)
        .where(eq(productionRuns.code, runCode));
      if (runRows.length > 0) {
        await db
          .delete(productionRunFeedstockDraws)
          .where(
            inArray(
              productionRunFeedstockDraws.productionRunId,
              runRows.map((run) => run.id),
            ),
          );
      }
      await db.delete(productionRuns).where(eq(productionRuns.code, runCode));
      await db
        .delete(binMovements)
        .where(eq(binMovements.storageLocationId, bin.id));
      await db.delete(feedstocks).where(eq(feedstocks.id, feedstock.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, bin.id));
      await db
        .delete(feedstockTypes)
        .where(eq(feedstockTypes.id, feedstockType.id));
      await db.delete(reactors).where(eq(reactors.id, reactor.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });

  it("serializes concurrent trucks against stock remaining after an explicit loss", async () => {
    const f = await postedFixture(); await postMeasurement(f, { kind: "loss", wetMassKg: 50 });
    const inputs = await Promise.all([deliveryInput(f, 40), deliveryInput(f, 40)]);
    const results = await Promise.allSettled(inputs.map(input => createDelivery(f.ctx, input)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBe(10);
  });

  it("waits for the source-bin advisory lock before locking source production rows", async () => {
    const f = await postedFixture(0); const input = await productInput(f);
    let release = () => {};
    let ready = () => {};
    let barrierPid = 0;
    const readyPromise = new Promise<void>(resolve => { ready = resolve; });
    const releasePromise = new Promise<void>(resolve => { release = resolve; });
    const barrier = db.transaction(async tx => {
      await lockBinStock(f.ctx, tx, f.source.id);
      barrierPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
      ready(); await releasePromise;
    });
    let creation: Promise<PromiseSettledResult<Awaited<ReturnType<typeof createBiocharProduct>>>[]> | undefined;
    try {
      await readyPromise;
      creation = Promise.allSettled([createBiocharProduct(f.ctx, input)]);
      await expect.poll(async () => (await db.execute<{ blocked: boolean }>(sql`
        select exists(select 1 from pg_stat_activity where ${barrierPid} = any(pg_blocking_pids(pid))) as blocked
      `)).rows[0].blocked, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(true);
      await expect(db.transaction(async tx => {
        await tx.execute(sql`select id from production_runs where id = ${f.runs[0].id} for update nowait`);
      })).resolves.toBeUndefined();
    } finally {
      release(); await barrier;
      const result = await creation;
      expect(result?.[0].status).toBe("fulfilled");
    }
  });

  it("rejects changing a used order formulation without moving delivery provenance", async () => {
    const f = await postedFixture(); const delivery = await postDelivery(f, 60);
    const before = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id));
    await expect(updateOrder(f.ctx, f.order.id, { formulationId: f.recipe.id })).rejects.toThrow(delivery.code);
    expect(await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id))).toEqual(before);
  });

  it("serializes explicit delivery correction with a commercial order shrink", async () => {
    const f = await postedFixture(); const delivery = await postDelivery(f, 60);
    const [allocation] = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, delivery.id));
    const input = { facilityId: f.facility.id, storageLocationId: f.bin.id, physicalDate: "2026-09-14", kind: "delivery" as const, wetMassKg: 80, moisturePercent: 0, correctsMovementId: allocation.movementId };
    const preview = await previewOutputStock(f.ctx, input);
    const results = await Promise.allSettled([
      postOutputStock(f.ctx, { ...input, basisFingerprint: preview.basisFingerprint, idempotencyKey: crypto.randomUUID(), reason: "E2E correction race" }),
      updateOrder(f.ctx, f.order.id, { quantityKg: 70 }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await getOutputBinDryBalance(f.ctx, f.bin.id)).toBeGreaterThanOrEqual(0);
  });
});
