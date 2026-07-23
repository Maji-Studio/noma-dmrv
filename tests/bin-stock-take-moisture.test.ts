import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  binMovements,
  facilities,
  feedstocks,
  feedstockTypes,
  storageLocations,
  users,
} from "@/db/schema";
import {
  createBinMovement,
  recordStockTakeMovement,
  StockTakeIncreaseError,
} from "@/data-access/bin-movements";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-bin-stock-take-moisture";

vi.mock("@/lib/auth/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/server")>();
  return {
    ...actual,
    requireOrgContext: vi.fn().mockResolvedValue({
      userId: "test-user-bin-stock-take-moisture",
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
      email: "bin-stock-take-moisture@example.com",
      name: "Bin Stock Take Moisture",
      emailVerified: true,
    })
    .onConflictDoNothing({ target: users.id });
});

describe("feedstock stock-take moisture integrity", () => {
  it("converts wet stock authoritatively and rejects increases at both boundaries", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-STOCK-MOIST-${tag}`,
        name: `Stock Moisture Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-STOCK-MOIST-${tag}`,
        name: `Stock Moisture Feedstock ${tag}`,
        category: "forestry",
      })
      .returning({ id: feedstockTypes.id });
    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        code: `BIN-STOCK-MOIST-${tag}`,
        name: `Stock Moisture Bin ${tag}`,
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
        code: `FS-STOCK-MOIST-${tag}`,
        status: "complete",
        massDryKg: 100,
        massWetKg: 125,
        moistureContentPercent: 20,
      })
      .returning({ id: feedstocks.id });

    try {
      const recorded = await recordStockTakeFn({
        storageLocationId: bin.id,
        lane: "feedstock",
        reason: "Confirm measured moisture",
        countedMassKg: 1,
        countedWetMassKg: 100,
        moistureRatioUsed: 0.2,
      });

      expect(recorded.success).toBe(true);
      if (!recorded.success) return;
      expect(Number(recorded.data.countedMassKg)).toBe(80);
      expect(Number(recorded.data.massDeltaKg)).toBe(-20);
      expect(Number(recorded.data.countedWetMassKg)).toBe(100);
      expect(Number(recorded.data.moistureRatioUsed)).toBe(0.2);

      const upwardAction = await recordStockTakeFn({
        storageLocationId: bin.id,
        lane: "feedstock",
        reason: "Higher physical count",
        countedMassKg: 0,
        countedWetMassKg: 101,
        moistureRatioUsed: 0.2,
      });
      expect(upwardAction).toMatchObject({
        success: false,
        field: "countedMassKg",
      });

      await expect(
        recordStockTakeMovement(ctx, {
          storageLocationId: bin.id,
          lane: "feedstock",
          reason: "Direct caller cannot increase stock",
          countedMassKg: 0,
          countedWetMassKg: 101,
          moistureRatioUsed: 0.2,
        }),
      ).rejects.toBeInstanceOf(StockTakeIncreaseError);

      await expect(
        createBinMovement(ctx, {
          storageLocationId: bin.id,
          lane: "feedstock",
          movementType: "adjustment",
          massDeltaKg: 1,
          reason: "Generic movement caller cannot bypass stock-take checks",
        }),
      ).rejects.toThrow("stock-take boundary");

      const movements = await db
        .select({ id: binMovements.id })
        .from(binMovements)
        .where(eq(binMovements.storageLocationId, bin.id));
      expect(movements).toHaveLength(1);
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
