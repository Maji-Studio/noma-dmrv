/**
 * Integration coverage for the `lastActivityAt` sort in `getStorageLocations`.
 *
 * `storageLocationLastActivityAt()` (src/data-access/storage-location-activity.ts)
 * is a correlated scalar subquery over five UNION branches, and four of them
 * read the same two tables under different join predicates. An unqualified or
 * mis-qualified column in any branch resolves against the wrong table *without
 * erroring* — the query still runs and simply orders by the wrong timestamp.
 * Only executing it against a real database catches that.
 *
 * The fixture gives every branch a bin whose position **only that branch can
 * produce**, so dropping or misqualifying any one of the five reorders the
 * result and fails the test:
 *
 *   bin A  feedstock arrival                      (branch 1)
 *   bin B  run drawing from it                    (branch 2)
 *   bin C  run filling it                         (branch 3)
 *   bin D  product drawn from it, via its run     (branch 4) — its own run is
 *          deliberately OLDER than bin A, so branch 3 cannot supply bin D's
 *          position; only the linked product's timestamp can.
 *   bin E  product stored in it                   (branch 5)
 *   bin Q  nothing at all                         (NULL, sorts last both ways)
 *
 * It also pins the two contract details the board depends on: nulls last in
 * both directions, and code as the tiebreaker so a bin cannot repeat a page.
 *
 * Skips when DATABASE_URL is unreachable, matching the other DB-backed specs.
 */
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { getStorageLocations } from "@/data-access/storage-locations";
import { facilities, reactors, storageLocations } from "@/db/schema/facilities";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import { productionRuns } from "@/db/schema/production";
import { biocharProducts } from "@/db/schema/products";

const TEST_USER_ID = "test-user-storage-activity-sort";
const PAGE_SIZE = 50;

/** Fixed instants, oldest first, so expectations read as an explicit ordering. */
const T1_FEEDSTOCK_IN = new Date("2026-01-05T08:00:00Z");
const T2_RUN_DRAW = new Date("2026-02-10T08:00:00Z");
const T3_RUN_FILL = new Date("2026-03-11T08:00:00Z");
const T4_PRODUCT_FROM_RUN = new Date("2026-05-05T08:00:00Z");
const T5_PRODUCT_STORED = new Date("2026-06-20T08:00:00Z");

/**
 * Bin D's own production run. Older than every other event on purpose: if the
 * linked-product branch stopped contributing, bin D would fall back to this and
 * sort below bin A, which the ordering assertion would catch.
 */
const BIN_D_RUN_CREATED = new Date("2025-11-02T08:00:00Z");

interface ActivitySortFixture {
  facilityId: string;
  reactorId: string;
  feedstockTypeId: string;
  /** Bins A..E, oldest activity first. */
  binIdsByAge: string[];
  quietBinId: string;
  feedstockIds: string[];
  productionRunIds: string[];
  biocharProductIds: string[];
}

async function createFixture(runId: string): Promise<ActivitySortFixture> {
  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-ACT-${runId}`,
        name: `Activity Sort Facility ${runId}`,
      })
      .returning({ id: facilities.id });

    const [reactor] = await tx
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        code: `R-ACT-${runId}`,
        identifier: `Activity Sort Reactor ${runId}`,
        facilityId: facility.id,
        reactorType: "auger",
      })
      .returning({ id: reactors.id });

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FST-ACT-${runId}`,
        name: `Activity Sort Type ${runId}`,
        category: "forestry",
      })
      .returning({ id: feedstockTypes.id });

    // Codes ascend A..F so the code tiebreaker is distinguishable from the
    // activity order, which is deliberately not alphabetical.
    const insertedBins = await tx
      .insert(storageLocations)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `BIN-ACT-A-${runId}`,
          name: `Activity Bin A ${runId}`,
          type: "feedstock_bin" as const,
          facilityId: facility.id,
          feedstockTypeId: feedstockType.id,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `BIN-ACT-B-${runId}`,
          name: `Activity Bin B ${runId}`,
          type: "feedstock_bin" as const,
          facilityId: facility.id,
          feedstockTypeId: feedstockType.id,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `BIN-ACT-C-${runId}`,
          name: `Activity Bin C ${runId}`,
          type: "biochar_bin" as const,
          facilityId: facility.id,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `BIN-ACT-D-${runId}`,
          name: `Activity Bin D ${runId}`,
          type: "biochar_bin" as const,
          facilityId: facility.id,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `BIN-ACT-E-${runId}`,
          name: `Activity Bin E ${runId}`,
          type: "product_bin" as const,
          facilityId: facility.id,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `BIN-ACT-F-${runId}`,
          name: `Activity Bin F ${runId}`,
          type: "feedstock_bin" as const,
          facilityId: facility.id,
          feedstockTypeId: feedstockType.id,
        },
      ])
      .returning({ id: storageLocations.id });

    const [binA, binB, binC, binD, binE, quietBin] = insertedBins;

    // Branch 1: feedstock arriving in bin A.
    const insertedFeedstocks = await tx
      .insert(feedstocks)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FS-ACT-${runId}`,
        facilityId: facility.id,
        status: "complete",
        feedstockTypeId: feedstockType.id,
        massDryKg: 80,
        massWetKg: 100,
        moistureContentPercent: 20,
        storageLocationId: binA.id,
        createdAt: T1_FEEDSTOCK_IN,
      })
      .returning({ id: feedstocks.id });

    // Branches 2 and 3: one run drawing from bin B, another filling bin C.
    // `(reactor_id, start_time)` is unique — one reactor cannot run twice at
    // once — so every run here gets a distinct start time.
    const insertedRuns = await tx
      .insert(productionRuns)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `PR-ACT-DRAW-${runId}`,
          facilityId: facility.id,
          reactorId: reactor.id,
          startTime: T2_RUN_DRAW,
          feedstockStorageLocationId: binB.id,
          createdAt: T2_RUN_DRAW,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `PR-ACT-FILL-${runId}`,
          facilityId: facility.id,
          reactorId: reactor.id,
          startTime: T3_RUN_FILL,
          biocharStorageLocationId: binC.id,
          createdAt: T3_RUN_FILL,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `PR-ACT-DRAWN-${runId}`,
          facilityId: facility.id,
          reactorId: reactor.id,
          startTime: BIN_D_RUN_CREATED,
          biocharStorageLocationId: binD.id,
          createdAt: BIN_D_RUN_CREATED,
        },
      ])
      .returning({ id: productionRuns.id });

    const binDRunId = insertedRuns[2].id;

    const insertedProducts = await tx
      .insert(biocharProducts)
      .values([
        // Branch 4: a product made from bin D's run, i.e. biochar drawn OUT of
        // bin D. Reached only through the join on `linked_production_run_id`.
        {
          organizationId: TEST_ORG_ID,
          code: `BP-ACT-DRAWN-${runId}`,
          facilityId: facility.id,
          linkedProductionRunId: binDRunId,
          createdAt: T4_PRODUCT_FROM_RUN,
        },
        // Branch 5: a product sitting IN bin E.
        {
          organizationId: TEST_ORG_ID,
          code: `BP-ACT-STORED-${runId}`,
          facilityId: facility.id,
          storageLocationId: binE.id,
          createdAt: T5_PRODUCT_STORED,
        },
      ])
      .returning({ id: biocharProducts.id });

    return {
      facilityId: facility.id,
      reactorId: reactor.id,
      feedstockTypeId: feedstockType.id,
      binIdsByAge: [binA.id, binB.id, binC.id, binD.id, binE.id],
      quietBinId: quietBin.id,
      feedstockIds: insertedFeedstocks.map((row) => row.id),
      productionRunIds: insertedRuns.map((row) => row.id),
      biocharProductIds: insertedProducts.map((row) => row.id),
    };
  });
}

async function cleanupFixture(fixture: ActivitySortFixture): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(biocharProducts)
      .where(inArray(biocharProducts.id, fixture.biocharProductIds));
    await tx
      .delete(productionRuns)
      .where(inArray(productionRuns.id, fixture.productionRunIds));
    await tx.delete(feedstocks).where(inArray(feedstocks.id, fixture.feedstockIds));
    await tx
      .delete(storageLocations)
      .where(
        inArray(storageLocations.id, [...fixture.binIdsByAge, fixture.quietBinId]),
      );
    await tx
      .delete(feedstockTypes)
      .where(eq(feedstockTypes.id, fixture.feedstockTypeId));
    await tx.delete(reactors).where(eq(reactors.id, fixture.reactorId));
    await tx.delete(facilities).where(eq(facilities.id, fixture.facilityId));
  });
}

beforeAll(() => ensureTestOrg());

describe("storage-location lastActivityAt sort", () => {
  it("orders bins by their newest inventory event, whichever source produced it", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await createFixture(runId);
    const ctx = makeTestOrgContext(TEST_USER_ID);

    try {
      const newestFirst = await getStorageLocations(ctx, {
        facilityId: fixture.facilityId,
        sortBy: "lastActivityAt",
        sortOrder: "desc",
        pageSize: PAGE_SIZE,
      });

      const [binA, binB, binC, binD, binE] = fixture.binIdsByAge;
      expect(newestFirst.items.map((bin) => bin.id)).toEqual([
        binE,
        binD,
        binC,
        binB,
        binA,
        fixture.quietBinId,
      ]);

      const oldestFirst = await getStorageLocations(ctx, {
        facilityId: fixture.facilityId,
        sortBy: "lastActivityAt",
        sortOrder: "asc",
        pageSize: PAGE_SIZE,
      });

      // Reversed at the head, but the quiet bin stays at the tail: "no activity"
      // is not an answer to "oldest activity first".
      expect(oldestFirst.items.map((bin) => bin.id)).toEqual([
        binA,
        binB,
        binC,
        binD,
        binE,
        fixture.quietBinId,
      ]);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("agrees with the lastActivity value the tile prints", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await createFixture(runId);

    try {
      const { items } = await getStorageLocations(makeTestOrgContext(TEST_USER_ID), {
        facilityId: fixture.facilityId,
        sortBy: "lastActivityAt",
        sortOrder: "desc",
        pageSize: PAGE_SIZE,
      });

      // The sort subquery and the enrichment CTE read the same five sources; if
      // they drifted, the board would sort by one timestamp and print another.
      // Asserted as an ordering rather than as instants: `created_at` is a naive
      // `timestamp`, so its round-trip carries the runner's offset, which is not
      // this query's contract.
      const activityDates = items.map((bin) => bin.lastActivity?.date ?? null);
      const printed = activityDates.slice(0, -1).map((date) => date!.getTime());
      expect(printed).toHaveLength(fixture.binIdsByAge.length);
      expect([...printed].sort((a, b) => b - a)).toEqual(printed);
      expect(activityDates.at(-1)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("breaks ties on code so a bin cannot repeat across pages", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await createFixture(runId);
    const ctx = makeTestOrgContext(TEST_USER_ID);

    try {
      // Three bins share the feedstock type and two share biochar, so `type`
      // alone cannot determine an order.
      const firstPage = await getStorageLocations(ctx, {
        facilityId: fixture.facilityId,
        sortBy: "type",
        sortOrder: "asc",
        page: 1,
        pageSize: 3,
      });
      const secondPage = await getStorageLocations(ctx, {
        facilityId: fixture.facilityId,
        sortBy: "type",
        sortOrder: "asc",
        page: 2,
        pageSize: 3,
      });

      const seen = [...firstPage.items, ...secondPage.items].map((bin) => bin.id);
      expect(seen).toHaveLength(6);
      expect(new Set(seen).size).toBe(seen.length);

      const codesWithinType = firstPage.items
        .filter((bin) => bin.type === firstPage.items[0].type)
        .map((bin) => bin.code);
      expect([...codesWithinType].sort()).toEqual(codesWithinType);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("puts uncapped bins after capped ones when sorting by capacity", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await createFixture(runId);
    const ctx = makeTestOrgContext(TEST_USER_ID);

    try {
      // Postgres defaults DESC to NULLS FIRST, which would lead a "Largest
      // capacity" board with every bin that has no capacity at all.
      const [smallest, largest] = fixture.binIdsByAge;
      await db
        .update(storageLocations)
        .set({ capacityKg: 500 })
        .where(eq(storageLocations.id, smallest));
      await db
        .update(storageLocations)
        .set({ capacityKg: 9000 })
        .where(eq(storageLocations.id, largest));

      const { items } = await getStorageLocations(ctx, {
        facilityId: fixture.facilityId,
        sortBy: "capacityKg",
        sortOrder: "desc",
        pageSize: PAGE_SIZE,
      });

      expect(items.slice(0, 2).map((bin) => bin.id)).toEqual([largest, smallest]);
      expect(items.slice(2).every((bin) => bin.capacityKg == null)).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
