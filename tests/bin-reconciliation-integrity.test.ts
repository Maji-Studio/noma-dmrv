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
import { createDelivery } from "@/data-access/deliveries";
import { createProductionRun } from "@/data-access/production-runs";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-bin-reconciliation";
const INITIAL_FEEDSTOCK_DRY_MASS_KG = 100;
const RECOUNTED_FEEDSTOCK_DRY_MASS_KG = 10;
const CONCURRENCY_BARRIER_TIMEOUT_MS = 5_000;

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

describe("bin reconciliation integrity", () => {
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
            reason: `Concurrent stock-take ${index}`,
          }),
        ),
      );
      expect(results.every((result) => result.success)).toBe(true);

      const enriched = await getStorageLocationWithFacility(
        makeTestOrgContext(TEST_USER_ID),
        bin.id,
      );
      expect(enriched.feedstockInventory.currentDryMassKg).toBe(90);
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
          countedMassKg: RECOUNTED_FEEDSTOCK_DRY_MASS_KG,
          reason: "Concurrent stock-take against production run",
        }),
        createProductionRun(ctx, {
          code: runCode,
          facilityId: facility.id,
          reactorId: reactor.id,
          status: "complete",
          startTime: new Date("2026-07-03T08:00:00Z"),
          endTime: new Date("2026-07-03T10:00:00Z"),
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
      if (stockTakeResult.status === "fulfilled") {
        expect(stockTakeResult.value.success).toBe(true);
      }

      const runSucceeded = productionRunResult.status === "fulfilled";
      const runRejectedAsOverdraw =
        productionRunResult.status === "rejected" &&
        productionRunResult.reason instanceof Error &&
        productionRunResult.reason.message.includes("Not enough feedstock in this bin");
      expect(runSucceeded).not.toBe(runRejectedAsOverdraw);

      const enriched = await getStorageLocationWithFacility(ctx, bin.id);
      expect(enriched.feedstockInventory.currentDryMassKg).toBe(
        RECOUNTED_FEEDSTOCK_DRY_MASS_KG,
      );
      expect(enriched.feedstockInventory.currentDryMassKg).toBeGreaterThanOrEqual(0);
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
      ).rejects.toThrow("50 kg available");

      const restoredCount = await recordStockTakeFn({
        storageLocationId: bin.id,
        lane: "product",
        countedMassKg: 100,
        reason: "Restore product stock for delivery race",
      });
      expect(restoredCount.success).toBe(true);

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
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, product.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, bin.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });
});
