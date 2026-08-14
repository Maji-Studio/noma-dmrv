import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
  storageLocations,
  users,
} from "@/db/schema";
import { getStorageLocationWithFacility } from "@/data-access/storage-locations";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-bin-reconciliation-stock-take";

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return {
    ...actual,
    requireOrgContext: vi.fn().mockResolvedValue({
      userId: "test-user-bin-reconciliation-stock-take",
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
      email: "bin-reconciliation-stock-take-test@example.com",
      name: "Bin Reconciliation Stock Take Test",
      emailVerified: true,
    })
    .onConflictDoNothing({ target: users.id });
});

describe("bin reconciliation stock-take integrity", () => {
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

});
