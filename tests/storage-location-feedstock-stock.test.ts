import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { getStorageLocationWithFacility } from "@/data-access/storage-locations";
import { getStorageLocationById as getStorageLocationOptionById } from "@/data-access/entities/storage-locations";
import { facilities, storageLocations } from "@/db/schema/facilities";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import { binMovements } from "@/db/schema/bin-movements";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

interface FeedstockStockFixture {
  facilityId: string;
  feedstockTypeId: string;
  storageLocationId: string;
  feedstockIds: string[];
}

async function createFixture(runId: string): Promise<FeedstockStockFixture> {
  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-FS-STOCK-${runId}`,
        name: `Feedstock Stock Facility ${runId}`,
      })
      .returning({ id: facilities.id });

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FST-FS-STOCK-${runId}`,
        name: `Feedstock Stock Type ${runId}`,
        category: "forestry",
      })
      .returning({ id: feedstockTypes.id });

    const [storageLocation] = await tx
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BIN-FS-STOCK-${runId}`,
        name: `Feedstock Stock Bin ${runId}`,
        type: "feedstock_bin",
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
      })
      .returning({ id: storageLocations.id });

    const insertedFeedstocks = await tx
      .insert(feedstocks)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `FS-STOCK-COMPLETE-${runId}`,
          facilityId: facility.id,
          status: "complete",
          feedstockTypeId: feedstockType.id,
          massDryKg: 80,
          massWetKg: 100,
          moistureContentPercent: 20,
          storageLocationId: storageLocation.id,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FS-STOCK-PENDING-${runId}`,
          facilityId: facility.id,
          status: "missing_data",
          feedstockTypeId: feedstockType.id,
          massDryKg: 120,
          massWetKg: 150,
          moistureContentPercent: 20,
          storageLocationId: storageLocation.id,
        },
      ])
      .returning({ id: feedstocks.id });

    return {
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      storageLocationId: storageLocation.id,
      feedstockIds: insertedFeedstocks.map((feedstock) => feedstock.id),
    };
  });
}

async function cleanupFixture(fixture: FeedstockStockFixture): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(binMovements)
      .where(eq(binMovements.storageLocationId, fixture.storageLocationId));
    await tx.delete(feedstocks).where(inArray(feedstocks.id, fixture.feedstockIds));
    await tx.delete(storageLocations).where(eq(storageLocations.id, fixture.storageLocationId));
    await tx.delete(feedstockTypes).where(eq(feedstockTypes.id, fixture.feedstockTypeId));
    await tx.delete(facilities).where(eq(facilities.id, fixture.facilityId));
  });
}


beforeAll(() => ensureTestOrg());

describe("storage-location feedstock stock", () => {
  it("keeps pending feedstock mass out of current bin stock", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await createFixture(runId);

    try {
      const storageLocation = await getStorageLocationWithFacility(
        makeTestOrgContext(TEST_USER_ID),
        fixture.storageLocationId,
      );

      expect(storageLocation.feedstockInventory.currentDryMassKg).toBe(80);
      expect(storageLocation.feedstockInventory.batchCount).toBe(1);
      expect(storageLocation.feedstockInventory.pendingDryMassKg).toBe(120);
      expect(storageLocation.feedstockInventory.pendingBatchCount).toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("surfaces pending feedstock mass in bin picker subtitles", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await createFixture(runId);

    try {
      const option = await getStorageLocationOptionById(
        makeTestOrgContext(TEST_USER_ID),
        fixture.storageLocationId,
      );

      expect(option?.subtitle).toContain("80 kg remaining");
      expect(option?.subtitle).toContain("120 kg pending completion");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("uses the latest stock-take moisture and falls back to intake moisture", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await createFixture(runId);

    try {
      const ctx = makeTestOrgContext(TEST_USER_ID);
      const beforeStockTake = await getStorageLocationWithFacility(
        ctx,
        fixture.storageLocationId,
      );

      expect(
        beforeStockTake.feedstockInventory.estimatedMoisturePercent,
      ).toBe(20);
      expect(beforeStockTake.feedstockInventory.estimatedWetMassKg).toBe(100);

      await db.insert(binMovements).values([
        {
          organizationId: TEST_ORG_ID,
          storageLocationId: fixture.storageLocationId,
          lane: "feedstock",
          movementType: "adjustment",
          massDeltaKg: 0,
          reason: "Older moisture snapshot",
          countedMassKg: 80,
          derivedMassKgAtTime: 80,
          countedWetMassKg: 80 / 0.7,
          moistureRatioUsed: 0.3,
          createdAt: new Date("2026-07-20T08:00:00Z"),
        },
        {
          organizationId: TEST_ORG_ID,
          storageLocationId: fixture.storageLocationId,
          lane: "feedstock",
          movementType: "adjustment",
          massDeltaKg: 0,
          reason: "Latest moisture snapshot",
          countedMassKg: 80,
          derivedMassKgAtTime: 80,
          countedWetMassKg: 80 / 0.65,
          moistureRatioUsed: 0.35,
          createdAt: new Date("2026-07-21T08:00:00Z"),
        },
      ]);

      const afterStockTake = await getStorageLocationWithFacility(
        ctx,
        fixture.storageLocationId,
      );

      expect(
        afterStockTake.feedstockInventory.estimatedMoisturePercent,
      ).toBe(35);
      expect(
        afterStockTake.feedstockInventory.estimatedWetMassKg,
      ).toBeCloseTo(80 / 0.65);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
