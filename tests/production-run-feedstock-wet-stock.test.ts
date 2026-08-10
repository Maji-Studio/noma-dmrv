import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assertFeedstockWetDrawWithinStock, deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import {
  createProductionRun,
  updateProductionRun,
} from "@/data-access/production-runs/mutations";
import { facilities, reactors, storageLocations } from "@/db/schema/facilities";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import { productionRunFeedstocks, productionRuns } from "@/db/schema/production";
import { SafeError } from "@/lib/errors";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-feedstock-wet-stock";
const AVAILABLE_WET_KG = 3_000;
const INTAKE_ESTIMATED_DRY_KG = 1_950;
const RUN_MOISTURE_PERCENT = 20;
const SMALLEST_OVERDRAW_KG = 3_000.001;

describe("production-run wet feedstock stock", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  let facilityId: string;
  let reactorId: string;
  let feedstockTypeId: string;
  let storageLocationId: string;
  let feedstockId: string;
  let productionRunId: string | undefined;

  beforeAll(async () => {
    await ensureTestOrg();

    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-WET-${tag}`,
        name: `Wet Stock Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    facilityId = facility.id;

    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        code: `R-WET-${tag}`,
        identifier: `Wet Stock Reactor ${tag}`,
        facilityId,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    reactorId = reactor.id;

    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-WET-${tag}`,
        name: `Wet Stock Feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    feedstockTypeId = feedstockType.id;

    const [storageLocation] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BIN-WET-${tag}`,
        name: `Wet Stock Bin ${tag}`,
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
        code: `FS-WET-${tag}`,
        facilityId,
        status: "complete",
        feedstockTypeId,
        massWetKg: AVAILABLE_WET_KG,
        massDryKg: INTAKE_ESTIMATED_DRY_KG,
        storageLocationId,
      })
      .returning({ id: feedstocks.id });
    feedstockId = feedstock.id;
  });

  afterAll(async () => {
    if (productionRunId) {
      await db
        .delete(productionRunFeedstocks)
        .where(eq(productionRunFeedstocks.productionRunId, productionRunId));
      await db
        .delete(productionRuns)
        .where(eq(productionRuns.id, productionRunId));
    }
    await db.delete(feedstocks).where(eq(feedstocks.id, feedstockId));
    await db
      .delete(storageLocations)
      .where(eq(storageLocations.id, storageLocationId));
    await db
      .delete(feedstockTypes)
      .where(eq(feedstockTypes.id, feedstockTypeId));
    await db.delete(reactors).where(eq(reactors.id, reactorId));
    await db.delete(facilities).where(eq(facilities.id, facilityId));
  });

  it("accepts the full wet stock, derives run dry mass, and rejects 0.001 kg more", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);

    const overdraw = db.transaction((tx) =>
      assertFeedstockWetDrawWithinStock(ctx, tx, {
        storageLocationId,
        requestedWetKg: SMALLEST_OVERDRAW_KG,
      }),
    );
    await expect(overdraw).rejects.toBeInstanceOf(SafeError);
    await expect(overdraw).rejects.toThrow(
      "Not enough wet feedstock in this bin",
    );

    const created = await createProductionRun(ctx, {
      code: `PR-WET-${tag}`,
      facilityId,
      reactorId,
      status: "running",
      startTime: new Date("2026-08-01T08:00:00Z"),
      endTime: null,
      feedstockStorageLocationId: storageLocationId,
      feedstockWetMassKg: AVAILABLE_WET_KG,
      feedstockMoisturePercent: RUN_MOISTURE_PERCENT,
    });
    productionRunId = created.id;

    expect(created.feedstockMassDryKg).toBe(2_400);
    expect(created.feedstocks).toEqual([
      expect.objectContaining({
        feedstockId,
        wetMassUsedKg: AVAILABLE_WET_KG,
      }),
    ]);
    expect(
      await deriveFeedstockWetStockKg(ctx, db, storageLocationId),
    ).toBe(0);

    const edited = await updateProductionRun(ctx, created.id, {
      feedstockWetMassKg: AVAILABLE_WET_KG,
      feedstockMoisturePercent: RUN_MOISTURE_PERCENT,
    });
    expect(edited.feedstockMassDryKg).toBe(2_400);
    expect(
      await deriveFeedstockWetStockKg(ctx, db, storageLocationId),
    ).toBe(0);
  });
});
