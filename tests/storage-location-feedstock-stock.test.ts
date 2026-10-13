import { deleteOutputFacilityFixtures, outputProductFixtureValues, deleteOutputProductFixtures } from "./helpers/output-contract-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { getFeedstockBinStock } from "@/data-access/feedstock-bin-ledger";
import { getStorageLocationWithFacility } from "@/data-access/storage-locations";
import { getStorageLocationById as getStorageLocationOptionById } from "@/data-access/entities/storage-locations";
import { getFacilities } from "@/data-access/facilities";
import { facilities, storageLocations } from "@/db/schema/facilities";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import { biocharProducts } from "@/db/schema/products";
import { binMovements, productionRunFeedstockDraws, productionRuns } from "@/db/schema";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";

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
      .values({ timezone: "UTC",
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
    await deleteOutputFacilityFixtures(tx, eq(facilities.id, fixture.facilityId));
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

      const ledger = await getFeedstockBinStock(makeTestOrgContext(TEST_USER_ID), fixture.storageLocationId);
      expect(ledger.currentWetKg).toBe(100);
      expect(ledger.entries).toHaveLength(1);
      expect(ledger.entries[0]).toMatchObject({ kind: "intake", sourceId: fixture.feedstockIds[0], estimatedDryKg: 80 });
      expect(ledger.batches[0]).toMatchObject({ wetKg: 100, dryKg: 80 });
      await expect(getFeedstockBinStock({ ...makeTestOrgContext(TEST_USER_ID), organizationId: "other-org" }, fixture.storageLocationId)).rejects.toThrow("Storage bin was not found");
      expect(storageLocation.feedstockInventory.currentWetMassKg).toBe(100);
      expect(storageLocation.feedstockInventory.estimatedDryMassKg).toBe(80);
      expect(storageLocation.feedstockInventory.batchCount).toBe(1);
      expect(storageLocation.feedstockInventory.pendingWetMassKg).toBe(150);
      expect(storageLocation.feedstockInventory.pendingBatchCount).toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps wet stock and intake links readable when an intake has no wet basis", async () => {
    const fixture = await createFixture(crypto.randomUUID().slice(0, 8).toUpperCase());
    try {
      await db.update(feedstocks).set({ status: "complete", massWetKg: null, moistureContentPercent: null }).where(eq(feedstocks.id, fixture.feedstockIds[1]));
      const ledger = await getFeedstockBinStock(makeTestOrgContext(TEST_USER_ID), fixture.storageLocationId);
      expect(ledger.currentWetKg).toBe(100);
      expect(ledger.entries.find(entry => entry.sourceId === fixture.feedstockIds[1])).toMatchObject({ wetDeltaKg: null });
      expect(ledger.entries.at(-1)?.estimatedDryKg).toBeNull();
      expect(ledger.batches[0].dryKg).toBeNull();
    } finally { await cleanupFixture(fixture); }
  });

  it("links run draws to runs, excludes cancelled runs and preserves old counts without changing the intake split", async () => {
    const fixture = await seedOutputStockParents(db);
    try {
      const [draw] = await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, fixture.runs[0].id));
      await db.update(feedstocks).set({ deliveryDate: new Date("2026-09-08T12:00:00Z") }).where(eq(feedstocks.storageLocationId, draw.storageLocationId));
      await db.update(productionRuns).set({ status: "cancelled", cancellationReason: "Test cancellation" }).where(eq(productionRuns.id, fixture.runs[1].id));
      await db.insert(binMovements).values([
        { organizationId: fixture.ctx.organizationId, storageLocationId: draw.storageLocationId, lane: "feedstock", movementType: "adjustment", massDeltaKg: -200,
          countedMassKg: 2800, countedWetMassKg: 2800, moistureRatioUsed: 0.2, reason: "Old count", createdAt: new Date("2026-09-12T12:00:00Z") },
        { organizationId: fixture.ctx.organizationId, storageLocationId: draw.storageLocationId, lane: "feedstock", movementType: "loss", massDeltaKg: -100,
          reason: "Spilled", createdAt: new Date("2026-09-13T12:00:00Z") },
      ]);
      const ledger = await getFeedstockBinStock(fixture.ctx, draw.storageLocationId);
      expect(ledger.entries.filter(entry => entry.kind === "run_draw")).toMatchObject([{ id: draw.id, sourceId: fixture.runs[0].id, wetDeltaKg: -3000 }]);
      expect(ledger.entries.find(entry => entry.kind === "count")).toMatchObject({ sourceId: null, countedWetKg: 2800, moisturePercent: 20 });
      expect(ledger.currentWetKg).toBe(2700);
      expect(ledger.entries.at(-1)).toMatchObject({ kind: "loss", sourceId: null, estimatedDryKg: 2430 });
      expect(ledger.batches[0]).toMatchObject({ wetKg: 2700, dryKg: 2430 });
    } finally { await cleanupOutputStockFixture(db, fixture.ctx.organizationId); }
  });

  it("surfaces pending feedstock mass in bin picker subtitles", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await createFixture(runId);

    try {
      const option = await getStorageLocationOptionById(
        makeTestOrgContext(TEST_USER_ID),
        fixture.storageLocationId,
      );

      expect(option?.subtitle).toContain("100 kg stored");
      expect(option?.subtitle).toContain(
        "150 kg pending intake (wet)",
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("subtracts composition ingredient draws from facility feedstock stock", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await createFixture(runId);
    const [product] = await db
      .insert(biocharProducts)
      .values(await outputProductFixtureValues(db, {
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
      }))
      .returning({ id: biocharProducts.id });

    try {
      const ledger = await getFeedstockBinStock(makeTestOrgContext(TEST_USER_ID), fixture.storageLocationId);
      expect(ledger.currentWetKg).toBe(70);
      expect(ledger.entries.find(entry => entry.kind === "ingredient_draw")).toMatchObject({ sourceId: product.id, wetDeltaKg: -30 });
      expect(ledger.batches[0]).toMatchObject({ wetKg: 70, dryKg: 56 });
      const result = await getFacilities(
        makeTestOrgContext(TEST_USER_ID),
        { search: `FAC-FS-STOCK-${runId}` },
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.inventorySummary.feedstockWetKg).toBe(70);
    } finally {
      await deleteOutputProductFixtures(db, eq(biocharProducts.id, product.id));
      await cleanupFixture(fixture);
    }
  });
});
