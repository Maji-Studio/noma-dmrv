import { feedstockFixtureValues, cleanupFeedstockFixtureParents } from "./helpers/feedstock-fixture";
import { deleteOutputFacilityFixtures, outputProductFixtureValues, deleteOutputProductFixtures } from "./helpers/output-contract-fixtures";
import { TEST_SITE_POSITION, ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
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
import { binMovements, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns } from "@/db/schema";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

interface FeedstockStockFixture {
  facilityId: string;
  feedstockTypeId: string;
  storageLocationId: string;
  feedstockIds: string[];
}

async function createFixture(runId: string, feedstockIds?: readonly string[]): Promise<FeedstockStockFixture> {
  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({ ...TEST_SITE_POSITION, timezone: "UTC",
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
      .values(await feedstockFixtureValues(tx, [
        {
          id: feedstockIds?.[0],
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
          id: feedstockIds?.[1],
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
      ]))
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
    await cleanupFeedstockFixtureParents(tx);
    await tx.delete(storageLocations).where(eq(storageLocations.id, fixture.storageLocationId));
    await tx.delete(feedstockTypes).where(eq(feedstockTypes.id, fixture.feedstockTypeId));
    await deleteOutputFacilityFixtures(tx, eq(facilities.id, fixture.facilityId));
  });
  await cleanupFeedstockFixtureParents(db);
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


  it("links run draws to runs, excludes cancelled runs and preserves old counts without changing the intake split", async () => {
    const fixture = await seedOutputStockParents(db);
    try {
      const [draw] = await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, fixture.runs[0].id));
      await db.update(feedstocks).set({ deliveryDate: new Date("2026-09-08T00:00:00Z") }).where(eq(feedstocks.storageLocationId, draw.storageLocationId));
      await db.update(productionRuns).set({ status: "cancelled", cancellationReason: "Test cancellation" }).where(eq(productionRuns.id, fixture.runs[1].id));
      await db.insert(binMovements).values([
        { organizationId: fixture.ctx.organizationId, storageLocationId: draw.storageLocationId, lane: "feedstock", movementType: "adjustment", massDeltaKg: -200,
          countedMassKg: 2800, countedWetMassKg: 2800, moistureRatioUsed: 0.2, reason: "Old count", createdAt: new Date("2026-09-12T12:00:00Z") },
        { occurredAt: new Date("2026-09-13T12:00:00.000Z"), organizationId: fixture.ctx.organizationId, storageLocationId: draw.storageLocationId, lane: "feedstock", movementType: "loss", massDeltaKg: -100,
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

it.each(["physical", "recorded", "id"] as const)("orders intake batches and timeline by physical time, recorded time, then id (%s)", async (orderBy) => {
  // Put insertion order against the tie-breakers, and id order against the earlier keys.
  const ids = [crypto.randomUUID(), crypto.randomUUID()].sort();
  if (orderBy !== "recorded") ids.reverse();
  const f = await createFixture(crypto.randomUUID().slice(0, 8).toUpperCase(), ids);
  try {
    const earlier = new Date("2026-09-08T00:00:00Z");
    const later = new Date("2026-09-09T00:00:00Z");
    await db.update(feedstocks).set({ deliveryDate: earlier, createdAt: orderBy === "id" ? earlier : later }).where(eq(feedstocks.id, ids[0]));
    await db.update(feedstocks).set({ status: "complete", deliveryDate: orderBy === "physical" ? later : earlier, createdAt: earlier }).where(eq(feedstocks.id, ids[1]));
    const ledger = await getFeedstockBinStock(makeTestOrgContext(TEST_USER_ID), f.storageLocationId);
    const expected = orderBy === "physical" ? ids : [...ids].reverse();
    expect(ledger.entries.map(entry => entry.id)).toEqual(expected);
    expect(ledger.batches.map(batch => batch.id)).toEqual(expected);
  } finally { await cleanupFixture(f); }
});

it.each([false, true])("keeps a loss on A before B arrives, including same-time entries (%s)", async (sameTime) => {
  const f = await createFixture(crypto.randomUUID().slice(0, 8).toUpperCase());
  try {
    const intakeTime = new Date("2026-09-08T00:00:00Z");
    const lossTime = sameTime ? intakeTime : new Date("2026-09-09T00:00:00Z");
    const secondTime = sameTime ? intakeTime : new Date("2026-09-10T00:00:00Z");
    await db.update(feedstocks).set({ deliveryDate: intakeTime, createdAt: new Date("2026-09-11T08:00:00Z") }).where(eq(feedstocks.id, f.feedstockIds[0]));
    await db.update(feedstocks).set({ status: "complete", massWetKg: 100, massDryKg: 50, moistureContentPercent: 50,
      deliveryDate: secondTime, createdAt: new Date("2026-09-11T08:10:00Z") }).where(eq(feedstocks.id, f.feedstockIds[1]));
    await db.insert(binMovements).values({ organizationId: TEST_ORG_ID, storageLocationId: f.storageLocationId, lane: "feedstock",
      movementType: "loss", massDeltaKg: -50, reason: "Spilled", occurredAt: lossTime, createdAt: new Date("2026-09-11T08:05:00Z") });
    const ledger = await getFeedstockBinStock(makeTestOrgContext(TEST_USER_ID), f.storageLocationId);
    expect(ledger.currentWetKg).toBe(150);
    expect(ledger.entries.map(entry => [entry.kind, entry.afterWetKg, entry.estimatedDryKg]))
      .toEqual([["intake", 100, 80], ["loss", 50, 40], ["intake", 150, 90]]);
    expect(ledger.batches).toMatchObject([{ id: f.feedstockIds[0], wetKg: 50, dryKg: 40 }, { id: f.feedstockIds[1], wetKg: 100, dryKg: 50 }]);
  } finally {
    await db.delete(binMovements).where(eq(binMovements.storageLocationId, f.storageLocationId));
    await cleanupFixture(f);
  }
});

it("charts only recorded intakes and saved draws within each same-time prefix", async () => {
  const f = await seedOutputStockParents(db);
  try {
    const instant = new Date("2026-09-08T00:00:00Z");
    const [draw] = await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, f.runs[0].id));
    await db.update(productionRuns).set({ status: "cancelled", cancellationReason: "Fixture" }).where(eq(productionRuns.id, f.runs[1].id));
    await db.update(productionRuns).set({ startTime: instant }).where(eq(productionRuns.id, f.runs[0].id));
    const [a] = await db.update(feedstocks).set({ massWetKg: 100, massDryKg: 80, moistureContentPercent: 20, deliveryDate: instant,
      createdAt: new Date("2026-09-11T08:00:00Z") }).where(eq(feedstocks.storageLocationId, draw.storageLocationId)).returning();
    await db.update(productionRunFeedstockDraws).set({ wetMassKg: 60, createdAt: new Date("2026-09-11T08:05:00Z") }).where(eq(productionRunFeedstockDraws.id, draw.id));
    await db.update(productionRunFeedstocks).set({ wetMassUsedKg: 60 }).where(eq(productionRunFeedstocks.productionRunId, f.runs[0].id));
    await db.insert(feedstocks).values(await feedstockFixtureValues(db, { organizationId: f.ctx.organizationId, facilityId: f.facility.id, feedstockTypeId: a.feedstockTypeId,
      storageLocationId: draw.storageLocationId, code: `E2E-FIFO-SAME-TIME-${f.tag}`, status: "complete", massWetKg: 100, massDryKg: 50,
      moistureContentPercent: 50, deliveryDate: instant, createdAt: new Date("2026-09-11T08:10:00Z") }));
    const ledger = await getFeedstockBinStock(f.ctx, draw.storageLocationId);
    expect(ledger.entries.map(entry => [entry.kind, entry.afterWetKg, entry.estimatedDryKg]))
      .toEqual([["intake", 100, 80], ["run_draw", 40, 32], ["intake", 140, 82]]);
  } finally { await cleanupOutputStockFixture(db, f.ctx.organizationId); }
});

it("keeps A40 and B100 after A100, a saved A60 run draw, then B100", async () => {
  const f = await seedOutputStockParents(db);
  try {
    const [draw] = await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, f.runs[0].id));
    await db.update(productionRuns).set({ status: "cancelled", cancellationReason: "Fixture" }).where(eq(productionRuns.id, f.runs[1].id));
    const [a] = await db.update(feedstocks).set({ massWetKg: 100, massDryKg: 80, moistureContentPercent: 20, deliveryDate: new Date("2026-09-08T00:00:00Z") })
      .where(eq(feedstocks.storageLocationId, draw.storageLocationId)).returning();
    await db.update(productionRunFeedstockDraws).set({ wetMassKg: 60 }).where(eq(productionRunFeedstockDraws.id, draw.id));
    await db.update(productionRunFeedstocks).set({ wetMassUsedKg: 60 }).where(eq(productionRunFeedstocks.productionRunId, f.runs[0].id));
    const [b] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, { organizationId: f.ctx.organizationId, facilityId: f.facility.id, feedstockTypeId: a.feedstockTypeId,
      storageLocationId: draw.storageLocationId, code: `E2E-FIFO-BATCH-B-${f.tag}`, status: "complete", massWetKg: 100, massDryKg: 50,
      moistureContentPercent: 50, deliveryDate: new Date("2026-09-10T00:00:00Z") })).returning();
    const ledger = await getFeedstockBinStock(f.ctx, draw.storageLocationId);
    expect(ledger.currentWetKg).toBe(140);
    expect(ledger.batches).toMatchObject([{ id: a.id, wetKg: 40, dryKg: 32 }, { id: b.id, wetKg: 100, dryKg: 50 }]);
    expect(ledger.entries.at(-1)?.estimatedDryKg).toBe(82);
  } finally { await cleanupOutputStockFixture(db, f.ctx.organizationId); }
});
