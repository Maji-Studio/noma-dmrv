import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  creditBatchProductionRuns,
  creditBatches,
  facilities,
  feedstocks,
  feedstockTypes,
  productionProcesses,
  productionRunFeedstockDraws,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  storageLocations,
} from "@/db/schema";
import {
  createCreditBatch,
  getCreditBatchById,
  updateCreditBatch,
} from "@/data-access/credit-batches";
import { getCreditBatchProductionRunOptions } from "@/data-access/credit-batch-production-run-options";
import {
  createProductionRun,
  getProductionRunById,
  updateProductionRun,
} from "@/data-access/production-runs";
import { SafeError } from "@/lib/errors";
import {
  cleanupFeedstockFixtureParents,
  feedstockFixtureValues,
} from "./helpers/feedstock-fixture";
import { createProductionRunOutputBin } from "./helpers/production-run-output-bin";
import { cleanupOutputFixtureParents } from "./helpers/output-contract-fixtures";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
  TEST_SITE_POSITION,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-credit-batch-facility-timezone";
const TAG_LENGTH = 8;
const FEEDSTOCK_WET_KG = 2_500;
const FEEDSTOCK_DRY_KG = 2_000;
const DRAW_WET_KG = 100;
const BIOCHAR_WET_KG = 30;
const MOISTURE_PERCENT = 20;
const SEPTEMBER = { startDate: "2025-09-01", endDate: "2025-09-30" };
const OCTOBER = { startDate: "2025-10-01", endDate: "2025-10-31" };
const AUGUST = { startDate: "2025-08-01", endDate: "2025-08-31" };
const DAR_ES_SALAAM = "Africa/Dar_es_Salaam";
const LOS_ANGELES = "America/Los_Angeles";
const DAR_START = "2025-09-30T18:00:00.000Z";
// October 1 at 01:00 in Dar es Salaam, still September 30 in UTC.
const DAR_END = "2025-09-30T22:00:00.000Z";
const LA_START = "2025-09-30T20:00:00.000Z";
// September 30 at 23:00 in Los Angeles, already October 1 in UTC.
const LA_END = "2025-10-01T06:00:00.000Z";

describe("credit batch membership by facility-local day", () => {
  const tag = crypto.randomUUID().slice(0, TAG_LENGTH).toUpperCase();
  const ctx = makeTestOrgContext(TEST_USER_ID);
  const facilityIds: string[] = [];
  const reactorIds: string[] = [];
  const feedstockTypeIds: string[] = [];
  const feedstockIds: string[] = [];
  const storageLocationIds: string[] = [];
  const creditBatchIds: string[] = [];
  const productionRunIds: string[] = [];

  beforeAll(() => ensureTestOrg());

  // Each case owns its cohort, so identical past dates and failed assertions
  // cannot leave assignments or reactor windows that affect another case.
  async function fixture(label: string, timezone: string) {
    const code = `${label}-${tag}`;
    const [facility] = await db.insert(facilities).values({
      ...TEST_SITE_POSITION,
      organizationId: TEST_ORG_ID,
      timezone,
      code: `FAC-TZ-${code}`,
      name: `Facility timezone facility ${code}`,
    }).returning({ id: facilities.id });
    facilityIds.push(facility.id);
    const outputBinId = await createProductionRunOutputBin(TEST_ORG_ID, facility.id);
    storageLocationIds.push(outputBinId);
    const [reactor] = await db.insert(reactors).values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      code: `RE-TZ-${code}`,
      identifier: `Facility timezone reactor ${code}`,
      reactorType: "auger",
    }).returning({ id: reactors.id });
    reactorIds.push(reactor.id);
    const [feedstockType] = await db.insert(feedstockTypes).values({
      organizationId: TEST_ORG_ID,
      code: `FT-TZ-${code}`,
      name: `Facility timezone feedstock ${code}`,
      category: "forestry",
      usage: "pyrolysis",
    }).returning({ id: feedstockTypes.id });
    feedstockTypeIds.push(feedstockType.id);
    const [bin] = await db.insert(storageLocations).values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      code: `BIN-TZ-${code}`,
      name: `Facility timezone feedstock bin ${code}`,
      type: "feedstock_bin",
    }).returning({ id: storageLocations.id });
    storageLocationIds.push(bin.id);
    const [feedstock] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      storageLocationId: bin.id,
      code: `FS-TZ-${code}`,
      status: "complete",
      massWetKg: FEEDSTOCK_WET_KG,
      massDryKg: FEEDSTOCK_DRY_KG,
      moistureContentPercent: MOISTURE_PERCENT,
    })).returning({ id: feedstocks.id });
    feedstockIds.push(feedstock.id);

    return {
      code,
      facilityId: facility.id,
      reactorId: reactor.id,
      feedstockTypeId: feedstockType.id,
      storageLocationId: bin.id,
      outputBinId,
    };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function batch(f: Fixture, window: typeof OCTOBER, label: string) {
    const saved = await createCreditBatch(ctx, {
      code: `CB-TZ-${label}-${f.code}`,
      facilityId: f.facilityId,
      feedstockTypeId: f.feedstockTypeId,
      startDate: new Date(`${window.startDate}T00:00:00.000Z`),
      endDate: new Date(`${window.endDate}T00:00:00.000Z`),
      productionRunIds: [],
    });
    creditBatchIds.push(saved.id);
    return saved;
  }

  async function run(f: Fixture, label: string, start: string, end: string | null) {
    const saved = await createProductionRun(ctx, {
      code: `PR-TZ-${label}-${f.code}`,
      facilityId: f.facilityId,
      reactorId: f.reactorId,
      status: end ? "complete" : "running",
      startTime: new Date(start),
      endTime: end ? new Date(end) : null,
      feedstockMoisturePercent: MOISTURE_PERCENT,
      feedstockDraws: [{ storageLocationId: f.storageLocationId, wetMassKg: DRAW_WET_KG }],
      ...(end ? {
        biocharStorageLocationId: f.outputBinId,
        biocharOutputKg: BIOCHAR_WET_KG,
        biocharMoisturePercent: MOISTURE_PERCENT,
      } : {}),
    });
    productionRunIds.push(saved.id);
    return saved;
  }

  async function memberIds(batchId: string) {
    const saved = await getCreditBatchById(ctx, batchId, { skipPreview: true });
    expect(saved).not.toBeNull();
    return saved!.productionRunIds;
  }

  async function assignments(runId: string) {
    return db.select({ creditBatchId: creditBatchProductionRuns.creditBatchId })
      .from(creditBatchProductionRuns)
      .where(eq(creditBatchProductionRuns.productionRunId, runId));
  }

  afterAll(async () => {
    if (creditBatchIds.length) {
      await db.delete(creditBatchProductionRuns)
        .where(inArray(creditBatchProductionRuns.creditBatchId, creditBatchIds));
    }
    if (productionRunIds.length) {
      await db.delete(productionRunFeedstockDraws)
        .where(inArray(productionRunFeedstockDraws.productionRunId, productionRunIds));
      await db.delete(productionRunFeedstocks)
        .where(inArray(productionRunFeedstocks.productionRunId, productionRunIds));
      await db.delete(productionRuns).where(inArray(productionRuns.id, productionRunIds));
    }
    if (creditBatchIds.length) {
      await db.delete(creditBatches).where(inArray(creditBatches.id, creditBatchIds));
    }
    if (facilityIds.length) {
      await db.delete(activityEvents).where(inArray(activityEvents.facilityId, facilityIds));
      await db.delete(productionProcesses).where(inArray(productionProcesses.facilityId, facilityIds));
    }
    if (feedstockIds.length) await db.delete(feedstocks).where(inArray(feedstocks.id, feedstockIds));
    await cleanupFeedstockFixtureParents(db);
    for (const facilityId of facilityIds) await cleanupOutputFixtureParents(db, facilityId);
    if (storageLocationIds.length) {
      await db.delete(storageLocations).where(inArray(storageLocations.id, storageLocationIds));
    }
    if (reactorIds.length) await db.delete(reactors).where(inArray(reactors.id, reactorIds));
    if (facilityIds.length) await db.delete(facilities).where(inArray(facilities.id, facilityIds));
    if (feedstockTypeIds.length) await db.delete(feedstockTypes).where(inArray(feedstockTypes.id, feedstockTypeIds));
  });

  it("automatically joins October when a run ends on October 1 in Dar es Salaam", async () => {
    const f = await fixture("AUTO-DAR", DAR_ES_SALAAM);
    const september = await batch(f, SEPTEMBER, "SEP");
    const october = await batch(f, OCTOBER, "OCT");
    const completed = await run(f, "COMPLETE", DAR_START, DAR_END);

    expect(await assignments(completed.id)).toEqual([{ creditBatchId: october.id }]);
    expect(await memberIds(october.id)).toEqual([completed.id]);
    expect(await memberIds(september.id)).toEqual([]);
  });

  it("includes an unassigned run ending on October 1 locally when creating October", async () => {
    const f = await fixture("CREATE-OCT", DAR_ES_SALAAM);
    const completed = await run(f, "COMPLETE", DAR_START, DAR_END);
    expect(await assignments(completed.id)).toEqual([]);

    const october = await batch(f, OCTOBER, "OCT");

    expect(october.productionRunIds).toEqual([completed.id]);
    expect(await memberIds(october.id)).toEqual([completed.id]);
    expect(await assignments(completed.id)).toEqual([{ creditBatchId: october.id }]);
  });

  it("leaves a run ending on October 1 locally unassigned when creating September", async () => {
    const f = await fixture("CREATE-SEP", DAR_ES_SALAAM);
    const completed = await run(f, "COMPLETE", DAR_START, DAR_END);
    expect(await assignments(completed.id)).toEqual([]);

    const september = await batch(f, SEPTEMBER, "SEP");

    expect(september.productionRunIds).toEqual([]);
    expect(await memberIds(september.id)).toEqual([]);
    expect(await assignments(completed.id)).toEqual([]);
  });

  it("offers a completed run only in its local end month and keeps its UTC start date", async () => {
    const f = await fixture("OPTIONS-COMPLETE", DAR_ES_SALAAM);
    const completed = await run(f, "COMPLETE", DAR_START, DAR_END);

    const october = await getCreditBatchProductionRunOptions(ctx, { facilityId: f.facilityId, ...OCTOBER });
    const september = await getCreditBatchProductionRunOptions(ctx, { facilityId: f.facilityId, ...SEPTEMBER });

    expect(october).toEqual([expect.objectContaining({
      id: completed.id,
      status: "complete",
      date: "2025-09-30",
    })]);
    expect(september).toEqual([]);
  });

  it("offers a running run only in its local start month and keeps its UTC start date", async () => {
    const f = await fixture("OPTIONS-RUNNING", DAR_ES_SALAAM);
    const running = await run(f, "RUNNING", DAR_END, null);

    const october = await getCreditBatchProductionRunOptions(ctx, { facilityId: f.facilityId, ...OCTOBER });
    const september = await getCreditBatchProductionRunOptions(ctx, { facilityId: f.facilityId, ...SEPTEMBER });

    expect(october).toEqual([expect.objectContaining({
      id: running.id,
      status: "running",
      date: "2025-09-30",
    })]);
    expect(september).toEqual([]);
    expect(await assignments(running.id)).toEqual([]);
  });

  it("automatically joins September when a run ends on September 30 in Los Angeles", async () => {
    const f = await fixture("AUTO-LA", LOS_ANGELES);
    const september = await batch(f, SEPTEMBER, "SEP");
    const october = await batch(f, OCTOBER, "OCT");
    const completed = await run(f, "COMPLETE", LA_START, LA_END);

    expect(await assignments(completed.id)).toEqual([{ creditBatchId: september.id }]);
    expect(await memberIds(september.id)).toEqual([completed.id]);
    expect(await memberIds(october.id)).toEqual([]);
  });

  it("refuses a run ending on September 30 locally when updating a batch to October", async () => {
    const f = await fixture("UPDATE-OCT", LOS_ANGELES);
    // August leaves the run unassigned under either date rule, isolating
    // explicit membership validation from automatic joining.
    const empty = await batch(f, AUGUST, "EMPTY");
    const completed = await run(f, "COMPLETE", LA_START, LA_END);
    expect(await assignments(completed.id)).toEqual([]);

    const refused = updateCreditBatch(ctx, empty.id, {
      expectedVersion: empty.version,
      startDate: new Date(`${OCTOBER.startDate}T00:00:00.000Z`),
      endDate: new Date(`${OCTOBER.endDate}T00:00:00.000Z`),
      productionRunIds: [completed.id],
    });

    await expect(refused).rejects.toBeInstanceOf(SafeError);
    await expect(refused).rejects.toThrow(/falls outside the credit batch production window/i);
    expect(await assignments(completed.id)).toEqual([]);
    expect(await getCreditBatchById(ctx, empty.id, { skipPreview: true })).toMatchObject({
      ...AUGUST,
      version: empty.version,
      productionRunIds: [],
    });
  });

  it("accepts a run ending on September 30 locally when updating a batch to September", async () => {
    const f = await fixture("UPDATE-SEP", LOS_ANGELES);
    const empty = await batch(f, AUGUST, "EMPTY");
    const completed = await run(f, "COMPLETE", LA_START, LA_END);
    expect(await assignments(completed.id)).toEqual([]);

    const updated = await updateCreditBatch(ctx, empty.id, {
      expectedVersion: empty.version,
      startDate: new Date(`${SEPTEMBER.startDate}T00:00:00.000Z`),
      endDate: new Date(`${SEPTEMBER.endDate}T00:00:00.000Z`),
      productionRunIds: [completed.id],
    });

    expect(updated.productionRunIds).toEqual([completed.id]);
    expect(await memberIds(empty.id)).toEqual([completed.id]);
    expect(await assignments(completed.id)).toEqual([{ creditBatchId: empty.id }]);
  });

  it("allows a September member to end later on September 30 locally but refuses October 1", async () => {
    const f = await fixture("EDIT-MEMBER", LOS_ANGELES);
    const completed = await run(f, "COMPLETE", LA_START, LA_END);
    const september = await batch(f, SEPTEMBER, "SEP");
    // Establish the same member under either date rule so this case tests
    // the existing-member guard independently of automatic inclusion.
    await db.insert(creditBatchProductionRuns).values({
      organizationId: TEST_ORG_ID,
      creditBatchId: september.id,
      productionRunId: completed.id,
    }).onConflictDoNothing();
    expect(await assignments(completed.id)).toEqual([{ creditBatchId: september.id }]);

    // 23:30 on September 30 in Los Angeles.
    const laterLocalSeptember = new Date("2025-10-01T06:30:00.000Z");
    const edited = await updateProductionRun(ctx, completed.id, {
      expectedVersion: completed.version,
      endTime: laterLocalSeptember,
    });
    expect(edited.endTime).toEqual(laterLocalSeptember);
    expect(await memberIds(september.id)).toEqual([completed.id]);

    // 01:00 on October 1 in Los Angeles.
    const refused = updateProductionRun(ctx, completed.id, {
      expectedVersion: edited.version,
      endTime: new Date("2025-10-01T08:00:00.000Z"),
    });
    await expect(refused).rejects.toBeInstanceOf(SafeError);
    await expect(refused).rejects.toThrow(/cannot be edited outside its declared cohort/i);
    expect(await getProductionRunById(ctx, completed.id)).toMatchObject({
      endTime: laterLocalSeptember,
      version: edited.version,
    });
    expect(await assignments(completed.id)).toEqual([{ creditBatchId: september.id }]);
  });
});
