import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { assertFeedstockWetDrawWithinStock } from "@/data-access/feedstock-wet-stock";
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

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000423";
const INITIAL_WET_STOCK_KG = 100;
const INTAKE_DRY_MASS_KG = 65;
const CONCURRENT_DRAW_KG = 60;

describe("bin stock guard concurrency (issue #423)", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const runIds: string[] = [];
  let facilityId: string;
  let reactorId: string;
  let feedstockTypeId: string;
  let storageLocationId: string;
  let feedstockId: string;

  beforeAll(() => ensureTestOrg());

  beforeAll(async () => {
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-DRAW-${tag}`,
        name: `Concurrent Draw Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    facilityId = facility.id;

    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        code: `R-DRAW-${tag}`,
        identifier: `Concurrent Draw Reactor ${tag}`,
        facilityId,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });
    reactorId = reactor.id;

    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-DRAW-${tag}`,
        name: `Concurrent Draw Feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    feedstockTypeId = feedstockType.id;

    const [storageLocation] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BIN-DRAW-${tag}`,
        name: `Concurrent Draw Bin ${tag}`,
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
        code: `FS-DRAW-${tag}`,
        facilityId,
        status: "complete",
        feedstockTypeId,
        massDryKg: INTAKE_DRY_MASS_KG,
        massWetKg: INITIAL_WET_STOCK_KG,
        storageLocationId,
      })
      .returning({ id: feedstocks.id });
    feedstockId = feedstock.id;

    const insertedRuns = await db
      .insert(productionRuns)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `PR-DRAW-A-${tag}`,
          facilityId,
          reactorId,
          feedstockStorageLocationId: storageLocationId,
          startTime: new Date("2026-06-01T08:00:00Z"),
          endTime: new Date("2026-06-01T09:00:00Z"),
        },
        {
          organizationId: TEST_ORG_ID,
          code: `PR-DRAW-B-${tag}`,
          facilityId,
          reactorId,
          feedstockStorageLocationId: storageLocationId,
          startTime: new Date("2026-06-01T10:00:00Z"),
          endTime: new Date("2026-06-01T11:00:00Z"),
        },
      ])
      .returning({ id: productionRuns.id });
    runIds.push(...insertedRuns.map((run) => run.id));
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      if (runIds.length > 0) {
        await tx
          .delete(productionRunFeedstocks)
          .where(inArray(productionRunFeedstocks.productionRunId, runIds));
        await tx
          .delete(productionRunFeedstockDraws)
          .where(inArray(productionRunFeedstockDraws.productionRunId, runIds));
        await tx.delete(productionRuns).where(inArray(productionRuns.id, runIds));
      }
      if (feedstockId) {
        await tx.delete(feedstocks).where(eq(feedstocks.id, feedstockId));
      }
      if (storageLocationId) {
        await tx
          .delete(storageLocations)
          .where(eq(storageLocations.id, storageLocationId));
      }
      if (feedstockTypeId) {
        await tx
          .delete(feedstockTypes)
          .where(eq(feedstockTypes.id, feedstockTypeId));
      }
      if (reactorId) {
        await tx.delete(reactors).where(eq(reactors.id, reactorId));
      }
      if (facilityId) {
        await tx.delete(facilities).where(eq(facilities.id, facilityId));
      }
    });
  });

  it("serializes concurrent draws so committed stock cannot go negative", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const draw = (productionRunId: string) =>
      db.transaction(async (tx) => {
        await assertFeedstockWetDrawWithinStock(ctx, tx, {
          storageLocationId,
          requestedWetKg: CONCURRENT_DRAW_KG,
        });
        await tx.insert(productionRunFeedstockDraws).values({
          organizationId: TEST_ORG_ID,
          productionRunId,
          storageLocationId,
          wetMassKg: CONCURRENT_DRAW_KG,
        });
        await tx.insert(productionRunFeedstocks).values({
          organizationId: TEST_ORG_ID,
          productionRunId,
          feedstockId,
          wetMassUsedKg: CONCURRENT_DRAW_KG,
        });
      });

    const results = await Promise.allSettled(runIds.map(draw));
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      SafeError,
    );

    const [consumption] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${productionRunFeedstockDraws.wetMassKg}), 0)`,
      })
      .from(productionRunFeedstockDraws)
      .where(inArray(productionRunFeedstockDraws.productionRunId, runIds));
    const remainingStockKg =
      INITIAL_WET_STOCK_KG - Number(consumption.total);

    expect(remainingStockKg).toBeGreaterThanOrEqual(0);
    expect(remainingStockKg).toBe(
      INITIAL_WET_STOCK_KG - CONCURRENT_DRAW_KG,
    );
  });
});
