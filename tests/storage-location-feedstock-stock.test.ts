import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { getStorageLocationWithFacility } from "@/data-access/storage-locations";
import { getStorageLocationById as getStorageLocationOptionById } from "@/data-access/entities/storage-locations";
import { getFacilities } from "@/data-access/facilities";
import { facilities, storageLocations } from "@/db/schema/facilities";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import { biocharProducts } from "@/db/schema/products";

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

      expect(option?.subtitle).toContain("80 kg stored");
      expect(option?.subtitle).toContain("120 kg pending completion");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("subtracts composition ingredient draws from facility feedstock stock", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await createFixture(runId);
    const [product] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: fixture.facilityId,
        code: `BP-FS-STOCK-${runId}`,
        massKg: 30,
        composition: {
          ingredients: [{
            formulationIngredientId: crypto.randomUUID(),
            feedstockTypeId: fixture.feedstockTypeId,
            storageLocationId: fixture.storageLocationId,
            massKg: 30,
            massDryKg: 24,
            moistureContentPercent: 20,
          }],
        },
      })
      .returning({ id: biocharProducts.id });

    try {
      const result = await getFacilities(
        makeTestOrgContext(TEST_USER_ID),
        { search: `FAC-FS-STOCK-${runId}` },
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.inventorySummary.feedstockDryKg).toBe(176);
    } finally {
      await db.delete(biocharProducts).where(eq(biocharProducts.id, product.id));
      await cleanupFixture(fixture);
    }
  });
});
