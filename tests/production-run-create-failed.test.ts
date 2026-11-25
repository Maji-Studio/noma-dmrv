import { feedstockFixtureValues, cleanupFeedstockFixtureParents } from "./helpers/feedstock-fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { createCreditBatch } from "@/data-access/credit-batches";
import { createProductionRun } from "@/data-access/production-runs/mutations";
import { deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import { facilities, reactors, storageLocations } from "@/db/schema/facilities";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import { creditBatches, creditBatchProductionRuns } from "@/db/schema/credits";
import { productionProcesses } from "@/db/schema/production-processes";
import { productionRunFeedstockDraws, productionRunFeedstocks, productionRuns } from "@/db/schema/production";
import { TEST_SITE_POSITION, ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const AVAILABLE_WET_KG = 1_000;
const DRAW_KG = 400;
const MOISTURE_PERCENT = 20;
const OUTPUT_KG = 50;

describe("create a production run as Failed", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const ctx = makeTestOrgContext("test-user-create-failed");
  let facilityId = "";
  const reactorIds: string[] = [];
  let feedstockTypeId = "";
  let binId = "";
  let feedstockId = "";
  const runIds: string[] = [];
  const batchIds: string[] = [];

  async function newReactor(label: string) {
    const [reactor] = await db.insert(reactors).values({
      organizationId: TEST_ORG_ID, code: `R-FAIL-${label}-${tag}`, identifier: `Failed ${label} ${tag}`,
      facilityId, reactorType: "auger",
    }).returning({ id: reactors.id });
    reactorIds.push(reactor.id);
    return reactor.id;
  }

  beforeAll(async () => {
    await ensureTestOrg();
    const [facility] = await db.insert(facilities).values({
      ...TEST_SITE_POSITION, timezone: "UTC", organizationId: TEST_ORG_ID,
      code: `FAC-FAIL-${tag}`, name: `Failed Facility ${tag}`,
    }).returning({ id: facilities.id });
    facilityId = facility.id;
    const [type] = await db.insert(feedstockTypes).values({
      organizationId: TEST_ORG_ID, code: `FT-FAIL-${tag}`, name: `Failed Feedstock ${tag}`,
      category: "forestry", usage: "pyrolysis",
    }).returning({ id: feedstockTypes.id });
    feedstockTypeId = type.id;
    const [bin] = await db.insert(storageLocations).values({
      organizationId: TEST_ORG_ID, code: `BIN-FAIL-${tag}`, name: `Failed Bin ${tag}`,
      type: "feedstock_bin", facilityId, feedstockTypeId,
    }).returning({ id: storageLocations.id });
    binId = bin.id;
    const [feedstock] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
      organizationId: TEST_ORG_ID, code: `FS-FAIL-${tag}`, facilityId, status: "complete", feedstockTypeId,
      massWetKg: AVAILABLE_WET_KG, massDryKg: 800, storageLocationId: binId,
    })).returning({ id: feedstocks.id });
    feedstockId = feedstock.id;
  });

  afterAll(async () => {
    if (runIds.length) {
      await db.delete(creditBatchProductionRuns).where(inArray(creditBatchProductionRuns.productionRunId, runIds));
      await db.delete(productionRunFeedstocks).where(inArray(productionRunFeedstocks.productionRunId, runIds));
      await db.delete(productionRunFeedstockDraws).where(inArray(productionRunFeedstockDraws.productionRunId, runIds));
      await db.delete(productionRuns).where(inArray(productionRuns.id, runIds));
    }
    if (batchIds.length) await db.delete(creditBatches).where(inArray(creditBatches.id, batchIds));
    await db.delete(productionProcesses).where(eq(productionProcesses.feedstockTypeId, feedstockTypeId));
    await db.delete(feedstocks).where(eq(feedstocks.id, feedstockId));
    await cleanupFeedstockFixtureParents(db);
    await db.delete(storageLocations).where(eq(storageLocations.id, binId));
    await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockTypeId));
    if (reactorIds.length) await db.delete(reactors).where(inArray(reactors.id, reactorIds));
    await db.delete(facilities).where(eq(facilities.id, facilityId));
  });

  it("saves a failed run with draws, withdraws the feedstock, and posts no output or credit batch membership", async () => {
    const batch = await createCreditBatch(ctx, {
      code: `CB-FAIL-${tag}`, facilityId, feedstockTypeId,
      startDate: new Date("2026-03-01T00:00:00.000Z"), endDate: new Date("2026-03-31T00:00:00.000Z"),
      productionRunIds: [],
    });
    batchIds.push(batch.id);

    const run = await createProductionRun(ctx, {
      code: `PR-FAIL-${tag}`, facilityId, reactorId: await newReactor("A"), status: "failed",
      startTime: new Date("2026-03-10T08:00:00Z"), endTime: new Date("2026-03-10T10:00:00Z"),
      feedstockMoisturePercent: MOISTURE_PERCENT,
      feedstockDraws: [{ storageLocationId: binId, wetMassKg: DRAW_KG }],
    });
    runIds.push(run.id);

    expect(run.status).toBe("failed");
    expect(run.feedstockMassDryKg).toBe(320);
    expect(await deriveFeedstockWetStockKg(ctx, db, binId)).toBe(AVAILABLE_WET_KG - DRAW_KG);
    const [stored] = await db.select({ outputPostedAt: productionRuns.outputPostedAt, biocharOutputKg: productionRuns.biocharOutputKg })
      .from(productionRuns).where(eq(productionRuns.id, run.id));
    expect(stored.outputPostedAt).toBeNull();
    expect(stored.biocharOutputKg).toBeNull();
    const memberships = await db.select().from(creditBatchProductionRuns)
      .where(eq(creditBatchProductionRuns.productionRunId, run.id));
    expect(memberships).toEqual([]);
  });

  it("posts no output stock even when biochar output is sent with a failed run", async () => {
    const run = await createProductionRun(ctx, {
      code: `PR-FAIL-OUT-${tag}`, facilityId, reactorId: await newReactor("B"), status: "failed",
      startTime: new Date("2026-03-11T08:00:00Z"), endTime: new Date("2026-03-11T10:00:00Z"),
      feedstockMoisturePercent: MOISTURE_PERCENT,
      feedstockDraws: [{ storageLocationId: binId, wetMassKg: 100 }],
      biocharOutputKg: OUTPUT_KG,
    });
    runIds.push(run.id);
    const [stored] = await db.select({ outputPostedAt: productionRuns.outputPostedAt })
      .from(productionRuns).where(eq(productionRuns.id, run.id));
    expect(stored.outputPostedAt).toBeNull();
    const memberships = await db.select().from(creditBatchProductionRuns)
      .where(eq(creditBatchProductionRuns.productionRunId, run.id));
    expect(memberships).toEqual([]);
  });

  it("refuses a failed run without an end time, feedstock or moisture", async () => {
    const reactorId = await newReactor("C");
    const base = {
      facilityId, reactorId, status: "failed" as const, startTime: new Date("2026-03-12T08:00:00Z"),
      endTime: new Date("2026-03-12T10:00:00Z"), feedstockMoisturePercent: MOISTURE_PERCENT,
      feedstockDraws: [{ storageLocationId: binId, wetMassKg: 100 }],
    };
    await expect(createProductionRun(ctx, { ...base, code: `PR-FAIL-NOEND-${tag}`, endTime: null }))
      .rejects.toThrow("A failed run needs an end time");
    await expect(createProductionRun(ctx, { ...base, code: `PR-FAIL-NODRAW-${tag}`, feedstockDraws: [] }))
      .rejects.toMatchObject({ code: "validation_failed" });
    await expect(createProductionRun(ctx, { ...base, code: `PR-FAIL-NOMOIST-${tag}`, feedstockMoisturePercent: null }))
      .rejects.toMatchObject({ code: "validation_failed" });
  });

  it("still refuses Cancelled on create", async () => {
    await expect(createProductionRun(ctx, {
      code: `PR-CANCEL-${tag}`, facilityId, reactorId: await newReactor("D"), status: "cancelled",
      startTime: new Date("2026-03-13T08:00:00Z"), endTime: null, cancellationReason: "Entered in error",
    })).rejects.toThrow("A new production run can only start as Running, Complete or Failed.");
  });

  it("scopes the create to the caller's organization", async () => {
    await expect(createProductionRun({ ...ctx, organizationId: "org_other_failed_create" }, {
      code: `PR-FAIL-ORG-${tag}`, facilityId, reactorId: await newReactor("E"), status: "failed",
      startTime: new Date("2026-03-14T08:00:00Z"), endTime: new Date("2026-03-14T10:00:00Z"),
      feedstockMoisturePercent: MOISTURE_PERCENT,
      feedstockDraws: [{ storageLocationId: binId, wetMassKg: 100 }],
    })).rejects.toThrow(/not found/i);
  });
});
