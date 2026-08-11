import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assertFeedstockWetDrawWithinStock, deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import {
  createProductionRun,
  updateProductionRun,
} from "@/data-access/production-runs/mutations";
import { facilities, reactors, storageLocations } from "@/db/schema/facilities";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import {
  productionRunFeedstockDraws,
  productionRunFeedstocks,
  productionRuns,
} from "@/db/schema/production";
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
const EXPECTED_RUN_DRY_KG = 2_400;
const SMALLEST_OVERDRAW_KG = 3_000.001;
const SECONDARY_AVAILABLE_WET_KG = 500;

describe("production-run wet feedstock stock", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  let facilityId: string;
  let reactorId: string;
  let feedstockTypeId: string;
  let secondaryFeedstockTypeId: string;
  let storageLocationId: string;
  let secondaryStorageLocationId: string;
  let feedstockId: string;
  let secondaryFeedstockId: string;
  const productionRunIds = new Set<string>();
  const concurrencyReactorIds: string[] = [];

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

    const createdConcurrencyReactors = await db
      .insert(reactors)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `R-WET-A-${tag}`,
          identifier: `Wet Stock Reactor A ${tag}`,
          facilityId,
          reactorType: "auger",
        },
        {
          organizationId: TEST_ORG_ID,
          code: `R-WET-B-${tag}`,
          identifier: `Wet Stock Reactor B ${tag}`,
          facilityId,
          reactorType: "auger",
        },
      ])
      .returning({ id: reactors.id });
    concurrencyReactorIds.push(
      ...createdConcurrencyReactors.map((createdReactor) => createdReactor.id),
    );

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

    const [secondaryFeedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-WET-SECOND-${tag}`,
        name: `Wet Stock Secondary Feedstock ${tag}`,
        category: "agricultural",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    secondaryFeedstockTypeId = secondaryFeedstockType.id;

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

    const [secondaryStorageLocation] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BIN-WET-SECOND-${tag}`,
        name: `Wet Stock Secondary Bin ${tag}`,
        type: "feedstock_bin",
        facilityId,
        feedstockTypeId: secondaryFeedstockTypeId,
      })
      .returning({ id: storageLocations.id });
    secondaryStorageLocationId = secondaryStorageLocation.id;

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

    const [secondaryFeedstock] = await db
      .insert(feedstocks)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FS-WET-SECOND-${tag}`,
        facilityId,
        status: "complete",
        feedstockTypeId: secondaryFeedstockTypeId,
        massWetKg: SECONDARY_AVAILABLE_WET_KG,
        massDryKg: 450,
        storageLocationId: secondaryStorageLocationId,
      })
      .returning({ id: feedstocks.id });
    secondaryFeedstockId = secondaryFeedstock.id;
  });

  afterAll(async () => {
    const runIds = [...productionRunIds];
    if (runIds.length > 0) {
      await db
        .delete(productionRunFeedstocks)
        .where(inArray(productionRunFeedstocks.productionRunId, runIds));
      await db
        .delete(productionRunFeedstockDraws)
        .where(inArray(productionRunFeedstockDraws.productionRunId, runIds));
      await db
        .delete(productionRuns)
        .where(inArray(productionRuns.id, runIds));
    }
    await db.delete(feedstocks).where(eq(feedstocks.id, secondaryFeedstockId));
    await db.delete(feedstocks).where(eq(feedstocks.id, feedstockId));
    await db
      .delete(storageLocations)
      .where(eq(storageLocations.id, secondaryStorageLocationId));
    await db
      .delete(storageLocations)
      .where(eq(storageLocations.id, storageLocationId));
    await db
      .delete(feedstockTypes)
      .where(eq(feedstockTypes.id, secondaryFeedstockTypeId));
    await db
      .delete(feedstockTypes)
      .where(eq(feedstockTypes.id, feedstockTypeId));
    if (concurrencyReactorIds.length > 0) {
      await db
        .delete(reactors)
        .where(inArray(reactors.id, concurrencyReactorIds));
    }
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
      feedstockDraws: [
        { storageLocationId, wetMassKg: AVAILABLE_WET_KG },
      ],
      feedstockMoisturePercent: RUN_MOISTURE_PERCENT,
    });
    productionRunIds.add(created.id);

    expect(created.feedstockMassDryKg).toBe(EXPECTED_RUN_DRY_KG);
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
      feedstockDraws: [
        { storageLocationId, wetMassKg: AVAILABLE_WET_KG },
      ],
      feedstockMoisturePercent: RUN_MOISTURE_PERCENT,
    });
    expect(edited.feedstockMassDryKg).toBe(EXPECTED_RUN_DRY_KG);
    expect(
      await deriveFeedstockWetStockKg(ctx, db, storageLocationId),
    ).toBe(0);
  });

  it("round-trips mixed pyrolysis feedstock types and restores each bin on edit", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const [runId] = [...productionRunIds];

    const mixed = await updateProductionRun(ctx, runId, {
      feedstockDraws: [
        { storageLocationId, wetMassKg: 1_000 },
        { storageLocationId: secondaryStorageLocationId, wetMassKg: 200 },
      ],
      feedstockMoisturePercent: RUN_MOISTURE_PERCENT,
    });

    expect(mixed.totalFeedstockWetMassKg).toBe(1_200);
    expect(mixed.feedstockDraws).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ storageLocationId, wetMassKg: 1_000 }),
        expect.objectContaining({
          storageLocationId: secondaryStorageLocationId,
          wetMassKg: 200,
        }),
      ]),
    );
    expect(await deriveFeedstockWetStockKg(ctx, db, storageLocationId)).toBe(
      2_000,
    );
    expect(
      await deriveFeedstockWetStockKg(ctx, db, secondaryStorageLocationId),
    ).toBe(300);

    await expect(
      updateProductionRun(ctx, runId, { feedstockWetMassKg: 500 }),
    ).rejects.toThrow(
      "This run draws from several bins. Send feedstockDraws to change its feedstock.",
    );

    const replaced = await updateProductionRun(ctx, runId, {
      feedstockDraws: [
        { storageLocationId: secondaryStorageLocationId, wetMassKg: 100 },
      ],
    });
    expect(replaced.totalFeedstockWetMassKg).toBe(100);
    expect(await deriveFeedstockWetStockKg(ctx, db, storageLocationId)).toBe(
      AVAILABLE_WET_KG,
    );
    expect(
      await deriveFeedstockWetStockKg(ctx, db, secondaryStorageLocationId),
    ).toBe(400);
  });

  it("rejects one overdrawn row without changing either saved draw", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const [runId] = [...productionRunIds];

    await expect(
      updateProductionRun(ctx, runId, {
        feedstockDraws: [
          { storageLocationId, wetMassKg: 100 },
          {
            storageLocationId: secondaryStorageLocationId,
            wetMassKg: SECONDARY_AVAILABLE_WET_KG + 0.001,
          },
        ],
      }),
    ).rejects.toThrow("Not enough wet feedstock in this bin");

    expect(await deriveFeedstockWetStockKg(ctx, db, storageLocationId)).toBe(
      AVAILABLE_WET_KG,
    );
    expect(
      await deriveFeedstockWetStockKg(ctx, db, secondaryStorageLocationId),
    ).toBe(400);
  });

  it("serializes concurrent draws against the same bin", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const requestedWetMassKg = 1_800;
    const createConcurrentRun = (reactor: string, suffix: string) =>
      createProductionRun(ctx, {
        code: `PR-WET-CONCURRENT-${suffix}-${tag}`,
        facilityId,
        reactorId: reactor,
        status: "draft",
        startTime: new Date(`2026-08-0${suffix}T08:00:00Z`),
        endTime: new Date(`2026-08-0${suffix}T09:00:00Z`),
        feedstockDraws: [{ storageLocationId, wetMassKg: requestedWetMassKg }],
      }).then((run) => {
        productionRunIds.add(run.id);
        return run;
      });

    const outcomes = await Promise.allSettled([
      createConcurrentRun(concurrencyReactorIds[0], "2"),
      createConcurrentRun(concurrencyReactorIds[1], "3"),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const rejection = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejection).toEqual(
      expect.objectContaining({
        reason: expect.objectContaining({
          message: "Not enough wet feedstock in this bin",
        }),
      }),
    );
  });
});
