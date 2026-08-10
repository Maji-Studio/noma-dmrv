import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  binMovements,
  biocharProducts,
  customers,
  deliveries,
  facilities,
  feedstocks,
  feedstockTypes,
  orders,
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
import { createDelivery, updateDelivery } from "@/data-access/deliveries";
import { updateOrder } from "@/data-access/orders";
import { createProductionRun } from "@/data-access/production-runs";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-bin-reconciliation";
const BIN_STOCK_LOCK_SCOPE = "bin-stock";
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

describe("bin reconciliation integrity", { timeout: CONCURRENCY_TEST_TIMEOUT_MS }, () => {
  it("subtracts delivered product mass from product-bin stock", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-DEL-STOCK-${tag}`,
        name: `Delivered Stock Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BIN-DEL-STOCK-${tag}`,
        name: `Delivered Stock Bin ${tag}`,
        type: "product_bin",
      })
      .returning({ id: storageLocations.id });
    const [product] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        storageLocationId: bin.id,
        code: `BP-DEL-STOCK-${tag}`,
        massKg: 100,
      })
      .returning({ id: biocharProducts.id });
    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CU-DEL-STOCK-${tag}`,
        name: `Delivered Stock Customer ${tag}`,
      })
      .returning({ id: customers.id });
    const [order] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        biocharProductId: product.id,
        customerId: customer.id,
        code: `OR-DEL-STOCK-${tag}`,
        orderDate: new Date("2026-07-01T00:00:00Z"),
        quantityKg: 40,
        packaging: "bagged",
      })
      .returning({ id: orders.id });
    const [delivery] = await db
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: product.id,
        storageLocationId: bin.id,
        code: `DL-DEL-STOCK-${tag}`,
        deliveryDate: new Date("2026-07-02T00:00:00Z"),
        status: "delivered",
        deliveredWetMassKg: 40,
      })
      .returning({ id: deliveries.id });

    try {
      const enriched = await getStorageLocationWithFacility(
        makeTestOrgContext(TEST_USER_ID),
        bin.id,
      );
      expect(enriched.productInventory.currentMassKg).toBe(60);
    } finally {
      await db.delete(deliveries).where(eq(deliveries.id, delivery.id));
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, product.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, bin.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });

  it("serializes concurrent stock-takes against the latest derived mass", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-TAKE-${tag}`,
        name: `Stock Take Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-TAKE-${tag}`,
        name: `Stock Take Feedstock ${tag}`,
        category: "forestry",
      })
      .returning({ id: feedstockTypes.id });
    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        code: `BIN-TAKE-${tag}`,
        name: `Stock Take Bin ${tag}`,
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
        code: `FS-TAKE-${tag}`,
        status: "complete",
        massDryKg: 100,
        massWetKg: 100,
        moistureContentPercent: 0,
      })
      .returning({ id: feedstocks.id });

    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          recordStockTakeFn({
            storageLocationId: bin.id,
            lane: "feedstock",
            countedMassKg: 90,
            countedWetMassKg: 90,
            moistureRatioUsed: 0,
            reason: `Concurrent stock-take ${index}`,
          }),
        ),
      );
      expect(results.every((result) => result.success)).toBe(true);

      const enriched = await getStorageLocationWithFacility(
        makeTestOrgContext(TEST_USER_ID),
        bin.id,
      );
      expect(enriched.feedstockInventory.currentWetMassKg).toBe(90);
    } finally {
      await db
        .delete(binMovements)
        .where(eq(binMovements.storageLocationId, bin.id));
      await db.delete(feedstocks).where(eq(feedstocks.id, feedstock.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, bin.id));
      await db
        .delete(feedstockTypes)
        .where(eq(feedstockTypes.id, feedstockType.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });

  it("serializes a zero-mass product delete with an ingredient-bin stock-take", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-TAKE-DELETE-${tag}`,
        name: `Stock Take Delete Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-TAKE-DELETE-${tag}`,
        name: `Stock Take Delete Feedstock ${tag}`,
        category: "forestry",
        usage: "blend",
      })
      .returning({ id: feedstockTypes.id });
    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        code: `BIN-TAKE-DELETE-${tag}`,
        name: `Stock Take Delete Bin ${tag}`,
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
        code: `FS-TAKE-DELETE-${tag}`,
        status: "complete",
        massDryKg: 100,
        massWetKg: 100,
        moistureContentPercent: 0,
      })
      .returning({ id: feedstocks.id });
    const [product] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BP-TAKE-DELETE-${tag}`,
        massKg: 0,
        composition: {
          ingredients: [{
            formulationIngredientId: crypto.randomUUID(),
            feedstockTypeId: feedstockType.id,
            storageLocationId: bin.id,
            massKg: 30,
            massDryKg: 30,
            moistureContentPercent: 0,
          }],
        },
      })
      .returning({ id: biocharProducts.id });

    let releaseBarrier = () => {};
    let barrierTransaction: Promise<void> | undefined;
    let concurrentResults:
      | Promise<[
          PromiseSettledResult<void>,
          PromiseSettledResult<Awaited<ReturnType<typeof recordStockTakeFn>>>,
        ]>
      | undefined;

    try {
      let signalBarrierReady = () => {};
      const barrierReady = new Promise<void>((resolve) => {
        signalBarrierReady = resolve;
      });
      const releaseBarrierPromise = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      let barrierBackendPid = 0;
      barrierTransaction = db.transaction(async (tx) => {
        await lockBinStock(ctx, tx, bin.id);
        const backend = await tx.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`,
        );
        barrierBackendPid = backend.rows[0]?.pid ?? 0;
        signalBarrierReady();
        await releaseBarrierPromise;
      });
      await barrierReady;

      const deletePromise = deleteBiocharProduct(ctx, product.id);

      await expect.poll(async () => {
        const waits = await db.execute<{ waiter_count: number }>(sql`
          select count(distinct waiting.pid)::int as waiter_count
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
            and held.pid = ${barrierBackendPid}
        `);
        return waits.rows[0]?.waiter_count ?? 0;
      }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(1);

      concurrentResults = Promise.allSettled([
        deletePromise,
        recordStockTakeFn({
          storageLocationId: bin.id,
          lane: "feedstock",
          countedMassKg: 70,
          countedWetMassKg: 70,
          moistureRatioUsed: 0,
          reason: "Concurrent stock-take against product delete",
        }),
      ]);

      releaseBarrier();
      await barrierTransaction;
      const [deleteResult, stockTakeResult] = await concurrentResults;
      expect(deleteResult.status).toBe("fulfilled");
      expect(stockTakeResult.status).toBe("fulfilled");
      if (stockTakeResult.status === "fulfilled") {
        expect(stockTakeResult.value.success).toBe(true);
      }
    } finally {
      releaseBarrier();
      await barrierTransaction?.catch(() => undefined);
      await concurrentResults?.catch(() => undefined);
      await db.delete(biocharProducts).where(eq(biocharProducts.id, product.id));
      await db.delete(binMovements).where(eq(binMovements.storageLocationId, bin.id));
      await db.delete(feedstocks).where(eq(feedstocks.id, feedstock.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, bin.id));
      await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockType.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
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

  it("serializes concurrent deliveries before checking product stock", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-DEL-RACE-${tag}`,
        name: `Delivery Race Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BIN-DEL-RACE-${tag}`,
        name: `Delivery Race Bin ${tag}`,
        type: "product_bin",
      })
      .returning({ id: storageLocations.id });
    const [product] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        storageLocationId: bin.id,
        code: `BP-DEL-RACE-${tag}`,
        massKg: 100,
      })
      .returning({ id: biocharProducts.id });
    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CU-DEL-RACE-${tag}`,
        name: `Delivery Race Customer ${tag}`,
      })
      .returning({ id: customers.id });
    const [order] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        biocharProductId: product.id,
        customerId: customer.id,
        code: `OR-DEL-RACE-${tag}`,
        orderDate: new Date("2026-07-01T00:00:00Z"),
        quantityKg: 120,
        packaging: "bagged",
      })
      .returning({ id: orders.id });

    try {
      const reducedCount = await recordStockTakeFn({
        storageLocationId: bin.id,
        lane: "product",
        countedMassKg: 50,
        reason: "Reduce product stock before delivery guard",
      });
      expect(reducedCount.success).toBe(true);

      await expect(
        createDelivery(ctx, {
          code: `DL-DEL-RACE-${tag}-MOVEMENT`,
          orderId: order.id,
          facilityId: facility.id,
          deliveryDate: new Date("2026-07-02T00:00:00Z"),
          biocharProductId: product.id,
          status: "delivered",
          deliveredWetMassKg: 60,
        }),
      ).rejects.toThrow(/^Not enough biochar in this bin$/);

      await db
        .insert(biocharProducts)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          storageLocationId: bin.id,
          code: `BP-DEL-RACE-SUPPLEMENTAL-${tag}`,
          massKg: 50,
        });

      const results = await Promise.allSettled(
        [1, 2].map((attempt) =>
          createDelivery(ctx, {
            code: `DL-DEL-RACE-${tag}-${attempt}`,
            orderId: order.id,
            facilityId: facility.id,
            deliveryDate: new Date("2026-07-02T00:00:00Z"),
            biocharProductId: product.id,
            status: "delivered",
            deliveredWetMassKg: 60,
          }),
        ),
      );

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

      const rows = await db
        .select({ deliveredWetMassKg: deliveries.deliveredWetMassKg })
        .from(deliveries)
        .where(eq(deliveries.orderId, order.id));
      expect(
        rows.reduce(
          (total, row) => total + Number(row.deliveredWetMassKg ?? 0),
          0,
        ),
      ).toBe(60);
    } finally {
      await db.delete(deliveries).where(eq(deliveries.orderId, order.id));
      await db
        .delete(binMovements)
        .where(eq(binMovements.storageLocationId, bin.id));
      await db
        .delete(biocharProducts)
        .where(eq(biocharProducts.code, `BP-DEL-RACE-SUPPLEMENTAL-${tag}`));
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, product.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, bin.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });

  it("takes the source advisory lock before the destination row lock for a bin-linked product create", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const productCode = `BP-ZERO-LOCK-${tag}`;
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-ZERO-LOCK-${tag}`,
        name: `Zero Lock Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `R-ZERO-LOCK-${tag}`,
        identifier: `Zero Lock Reactor ${tag}`,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    const [sourceBin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BIN-ZERO-SOURCE-${tag}`,
        name: `Zero Source Bin ${tag}`,
        type: "biochar_bin",
      })
      .returning({ id: storageLocations.id });
    const [destinationBin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BIN-ZERO-DEST-${tag}`,
        name: `Zero Destination Bin ${tag}`,
        type: "product_bin",
      })
      .returning({ id: storageLocations.id });
    const [run] = await db
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        reactorId: reactor.id,
        code: `PR-ZERO-LOCK-${tag}`,
        status: "complete",
        startTime: new Date("2026-07-04T08:00:00Z"),
        endTime: new Date("2026-07-04T10:00:00Z"),
        biocharOutputKg: 10,
        biocharStorageLocationId: sourceBin.id,
      })
      .returning({ id: productionRuns.id });

    let releaseSourceLock = () => {};
    let sourceLockTransaction: Promise<void> | undefined;
    let createPromise: ReturnType<typeof createBiocharProduct> | undefined;

    try {
      let signalSourceLockReady = () => {};
      const sourceLockReady = new Promise<void>((resolve) => {
        signalSourceLockReady = resolve;
      });
      const releaseSourceLockPromise = new Promise<void>((resolve) => {
        releaseSourceLock = resolve;
      });
      let sourceLockBackendPid = 0;
      sourceLockTransaction = db.transaction(async (tx) => {
        const lockKey = `${BIN_STOCK_LOCK_SCOPE}:${TEST_ORG_ID}:${sourceBin.id}`;
        await tx.execute(sql`
          select pg_advisory_xact_lock(
            hashtextextended(${lockKey}, 0)
          )
        `);
        const backend = await tx.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`,
        );
        sourceLockBackendPid = backend.rows[0]?.pid ?? 0;
        signalSourceLockReady();
        await releaseSourceLockPromise;
      });
      await sourceLockReady;

      createPromise = createBiocharProduct(ctx, {
        code: productCode,
        facilityId: facility.id,
        linkedProductionRunId: run.id,
        storageLocationId: destinationBin.id,
        massKg: 1,
        moistureContentPercent: 0,
        waterAddedKg: 0,
      });
      // Same handler-attach window as the delivery update below: a rejection
      // landing before the expectation attaches would fail the run as an
      // unhandled rejection instead of the real assertion.
      createPromise.catch(() => {});

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
              and held.pid = ${sourceLockBackendPid}
          ) as waiting
        `);
        return result.rows[0]?.waiting ?? false;
      }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(true);

      await expect(db.transaction(async (tx) => {
        await tx.execute(sql`
          select ${storageLocations.id}
          from ${storageLocations}
          where ${storageLocations.id} = ${destinationBin.id}
          for update nowait
        `);
      })).resolves.toBeUndefined();

      // The create must not lock the run before it obtains the source-bin
      // advisory lock. updateProductionRun uses bins -> run; this NOWAIT probe
      // makes the shared global order deterministic and catches run -> bin ABBA.
      await expect(db.transaction(async (tx) => {
        await tx.execute(sql`
          select ${productionRuns.id}
          from ${productionRuns}
          where ${productionRuns.id} = ${run.id}
          for update nowait
        `);
      })).resolves.toBeUndefined();

      releaseSourceLock();
      await sourceLockTransaction;
      await expect(createPromise).resolves.toMatchObject({ massKg: 1 });
    } finally {
      releaseSourceLock();
      await sourceLockTransaction?.catch(() => undefined);
      await createPromise?.catch(() => undefined);
      await db.delete(biocharProducts).where(eq(biocharProducts.code, productCode));
      await db.delete(productionRuns).where(eq(productionRuns.id, run.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, destinationBin.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, sourceBin.id));
      await db.delete(reactors).where(eq(reactors.id, reactor.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });

  it("rejects reassigning an order when inherited delivered mass overdraws the new product", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-ORDER-DRAW-${tag}`,
        name: `Order Draw Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [oldBin, newBin] = await db
      .insert(storageLocations)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BIN-ORDER-OLD-${tag}`,
          name: `Order Old Bin ${tag}`,
          type: "product_bin" as const,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BIN-ORDER-NEW-${tag}`,
          name: `Order New Bin ${tag}`,
          type: "product_bin" as const,
        },
      ])
      .returning({ id: storageLocations.id });
    const [oldProduct, newProduct] = await db
      .insert(biocharProducts)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          storageLocationId: oldBin.id,
          code: `BP-ORDER-OLD-${tag}`,
          massKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          storageLocationId: newBin.id,
          code: `BP-ORDER-NEW-${tag}`,
          massKg: 50,
        },
      ])
      .returning({ id: biocharProducts.id });
    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CU-ORDER-DRAW-${tag}`,
        name: `Order Draw Customer ${tag}`,
      })
      .returning({ id: customers.id });
    const [order] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        biocharProductId: oldProduct.id,
        customerId: customer.id,
        code: `OR-ORDER-DRAW-${tag}`,
        orderDate: new Date("2026-07-05T00:00:00Z"),
        quantityKg: 60,
        packaging: "bagged",
      })
      .returning({ id: orders.id });
    const [delivery] = await db
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: null,
        code: `DL-ORDER-DRAW-${tag}`,
        deliveryDate: new Date("2026-07-06T00:00:00Z"),
        status: "delivered",
        deliveredWetMassKg: 60,
      })
      .returning({ id: deliveries.id });

    try {
      await expect(
        updateOrder(ctx, order.id, { biocharProductId: newProduct.id }),
      ).rejects.toThrow(/^Not enough biochar in this product$/);

      const [unchanged] = await db
        .select({ biocharProductId: orders.biocharProductId })
        .from(orders)
        .where(eq(orders.id, order.id));
      expect(unchanged.biocharProductId).toBe(oldProduct.id);
    } finally {
      await db.delete(deliveries).where(eq(deliveries.id, delivery.id));
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, oldProduct.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, newProduct.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, oldBin.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, newBin.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });

  it("locks the inherited order before validating a delivery stock transition", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-DEL-ORDER-LOCK-${tag}`,
        name: `Delivery Order Lock Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [oldProduct, newProduct] = await db
      .insert(biocharProducts)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BP-DEL-ORDER-OLD-${tag}`,
          massKg: 100,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BP-DEL-ORDER-NEW-${tag}`,
          massKg: 50,
        },
      ])
      .returning({ id: biocharProducts.id });
    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CU-DEL-ORDER-LOCK-${tag}`,
        name: `Delivery Order Lock Customer ${tag}`,
      })
      .returning({ id: customers.id });
    const [order] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        biocharProductId: oldProduct.id,
        customerId: customer.id,
        code: `OR-DEL-ORDER-LOCK-${tag}`,
        orderDate: new Date("2026-07-07T00:00:00Z"),
        quantityKg: 60,
        packaging: "bagged",
      })
      .returning({ id: orders.id });
    const [delivery] = await db
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: null,
        code: `DL-DEL-ORDER-LOCK-${tag}`,
        deliveryDate: new Date("2026-07-08T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 60,
      })
      .returning({ id: deliveries.id });

    let releaseOrderUpdate = () => {};
    let orderUpdateTransaction: Promise<void> | undefined;
    let deliveryUpdatePromise: ReturnType<typeof updateDelivery> | undefined;

    try {
      let signalOrderUpdateReady = () => {};
      const orderUpdateReady = new Promise<void>((resolve) => {
        signalOrderUpdateReady = resolve;
      });
      const releaseOrderUpdatePromise = new Promise<void>((resolve) => {
        releaseOrderUpdate = resolve;
      });
      let orderUpdateBackendPid = 0;
      orderUpdateTransaction = db.transaction(async (tx) => {
        await tx
          .update(orders)
          .set({ biocharProductId: newProduct.id })
          .where(eq(orders.id, order.id));
        const backend = await tx.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`,
        );
        orderUpdateBackendPid = backend.rows[0]?.pid ?? 0;
        signalOrderUpdateReady();
        await releaseOrderUpdatePromise;
      });
      await orderUpdateReady;

      deliveryUpdatePromise = updateDelivery(ctx, delivery.id, {
        status: "delivered",
      });
      // The update can reject in the window between the barrier committing and
      // the `.rejects` expectation below attaching — pre-attach a no-op
      // handler so the runner never sees an unhandled rejection (flaked in
      // CI). `expect(...).rejects` still observes the rejection.
      deliveryUpdatePromise.catch(() => {});

      await expect.poll(async () => {
        const result = await db.execute<{ waiting: boolean }>(sql`
          select exists (
            select 1
            from pg_stat_activity
            where ${orderUpdateBackendPid} = any(pg_blocking_pids(pid))
          ) as waiting
        `);
        return result.rows[0]?.waiting ?? false;
      }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(true);

      releaseOrderUpdate();
      await orderUpdateTransaction;
      // The delivery is refused, not silently mis-attributed — that is the
      // invariant. It surfaces as the snapshot-retry error rather than a
      // specific over-draw figure because the global lock order forbids holding
      // a row lock while discovering which bin to lock: the bins are chosen from
      // an unlocked read, locked, then re-checked, and the concurrent re-point
      // invalidates that snapshot. Re-deriving instead would mean drawing
      // against a bin this transaction never locked.
      await expect(deliveryUpdatePromise).rejects.toThrow(
        "Stock changed while this operation was being prepared",
      );

      const [unchanged] = await db
        .select({ status: deliveries.status })
        .from(deliveries)
        .where(eq(deliveries.id, delivery.id));
      expect(unchanged.status).toBe("upcoming");
    } finally {
      releaseOrderUpdate();
      await orderUpdateTransaction?.catch(() => undefined);
      await deliveryUpdatePromise?.catch(() => undefined);
      await db.delete(deliveries).where(eq(deliveries.id, delivery.id));
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, oldProduct.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, newProduct.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });
});
