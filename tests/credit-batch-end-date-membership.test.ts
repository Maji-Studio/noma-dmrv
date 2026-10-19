import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  certificationSubmissions,
  certifierProjects,
  certifierRemovals,
  creditBatchApplications,
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
import { getProductionBatchRegistryInputs } from "@/data-access/certifier-production-batches";
import {
  isCreditBatchMembershipLockedBySubmission,
  lockCreditBatchArtifacts,
} from "@/data-access/credit-batch-certification-lock";
import {
  createProductionRun,
  getProductionRunById,
  updateProductionRun,
} from "@/data-access/production-runs";
import { getCreditBatchProductionSpanIssue } from "@/lib/credit-batch-production-span";
import { SafeError } from "@/lib/errors";
import {
  cleanupFeedstockFixtureParents,
  feedstockFixtureValues,
} from "./helpers/feedstock-fixture";
import { createProductionRunOutputBin } from "./helpers/production-run-output-bin";
import { createBiocharApplicationChain } from "./helpers/biochar-application-chain";
import { cleanupOutputFixtureParents } from "./helpers/output-contract-fixtures";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
  TEST_SITE_POSITION,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-credit-batch-end-date";
const TAG_LENGTH = 8;
const FEEDSTOCK_WET_KG = 2_500;
const FEEDSTOCK_DRY_KG = 2_000;
const DRAW_WET_KG = 100;
const BIOCHAR_WET_KG = 30;
const BIOCHAR_DRY_KG = 24;
const MOISTURE_PERCENT = 20;
const SUBMISSION_VERSION = 1;
const SEPTEMBER = { startDate: "2025-09-01", endDate: "2025-09-30" };
const OCTOBER = { startDate: "2025-10-01", endDate: "2025-10-31" };
const AUGUST = { startDate: "2025-08-01", endDate: "2025-08-31" };
const CROSS_MONTH_START = "2025-09-30T22:00:00.000Z";
const CROSS_MONTH_END = "2025-10-02T06:00:00.000Z";

describe("credit batch membership by production run end date", () => {
  const tag = crypto.randomUUID().slice(0, TAG_LENGTH).toUpperCase();
  const ctx = makeTestOrgContext(TEST_USER_ID);
  const facilityIds: string[] = [];
  const reactorIds: string[] = [];
  const feedstockTypeIds: string[] = [];
  const feedstockIds: string[] = [];
  const storageLocationIds: string[] = [];
  const creditBatchIds: string[] = [];
  const productionRunIds: string[] = [];
  const removalIds: string[] = [];
  const chains: Awaited<ReturnType<typeof createBiocharApplicationChain>>[] = [];

  beforeAll(() => ensureTestOrg());

  // Each case owns its cohort, so identical past dates and failed assertions
  // cannot leave assignments or reactor windows that affect another case.
  async function fixture(label: string) {
    const code = `${label}-${tag}`;
    const [facility] = await db.insert(facilities).values({
      ...TEST_SITE_POSITION,
      organizationId: TEST_ORG_ID,
      timezone: "UTC",
      code: `FAC-END-${code}`,
      name: `End date facility ${code}`,
    }).returning({ id: facilities.id });
    facilityIds.push(facility.id);
    const outputBinId = await createProductionRunOutputBin(TEST_ORG_ID, facility.id);
    storageLocationIds.push(outputBinId);
    const [reactor] = await db.insert(reactors).values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      code: `RE-END-${code}`,
      identifier: `End date reactor ${code}`,
      reactorType: "auger",
    }).returning({ id: reactors.id });
    reactorIds.push(reactor.id);
    const [feedstockType] = await db.insert(feedstockTypes).values({
      organizationId: TEST_ORG_ID,
      code: `FT-END-${code}`,
      name: `End date feedstock ${code}`,
      category: "forestry",
      usage: "pyrolysis",
    }).returning({ id: feedstockTypes.id });
    feedstockTypeIds.push(feedstockType.id);
    const [bin] = await db.insert(storageLocations).values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      code: `BIN-END-${code}`,
      name: `End date feedstock bin ${code}`,
      type: "feedstock_bin",
    }).returning({ id: storageLocations.id });
    storageLocationIds.push(bin.id);
    const [feedstock] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      storageLocationId: bin.id,
      code: `FS-END-${code}`,
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

  async function mapToIsometric(f: Fixture) {
    await db.update(feedstockTypes)
      .set({ isometricFeedstockTypeId: `ftt_${f.code}` })
      .where(eq(feedstockTypes.id, f.feedstockTypeId));
    const [project] = await db.insert(certifierProjects).values({
      organizationId: TEST_ORG_ID,
      facilityId: f.facilityId,
      provider: "isometric",
      externalProjectId: `prj_${f.code}`,
      externalFacilityId: `fcl_${f.code}`,
    }).returning();
    return project;
  }

  async function batch(f: Fixture, window: typeof OCTOBER, label: string) {
    const saved = await createCreditBatch(ctx, {
      code: `CB-END-${label}-${f.code}`,
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
      code: `PR-END-${label}-${f.code}`,
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
      await db.delete(creditBatchApplications)
        .where(inArray(creditBatchApplications.creditBatchId, creditBatchIds));
      await db.delete(creditBatchProductionRuns)
        .where(inArray(creditBatchProductionRuns.creditBatchId, creditBatchIds));
    }
    if (removalIds.length) {
      await db.delete(certificationSubmissions)
        .where(inArray(certificationSubmissions.localEntityId, removalIds));
      await db.delete(certifierRemovals).where(inArray(certifierRemovals.id, removalIds));
    }
    for (const chain of chains) await chain.cleanup();
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
      await db.delete(certifierProjects).where(inArray(certifierProjects.facilityId, facilityIds));
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

  it("automatically joins October when a completed run starts in September and ends in October", async () => {
    const f = await fixture("AUTO");
    const september = await batch(f, SEPTEMBER, "SEP");
    const october = await batch(f, OCTOBER, "OCT");
    const completed = await run(f, "CROSS", CROSS_MONTH_START, CROSS_MONTH_END);

    expect(await assignments(completed.id)).toEqual([{ creditBatchId: october.id }]);
    expect(await memberIds(october.id)).toEqual([completed.id]);
    expect(await memberIds(september.id)).toEqual([]);
  });

  it("joins October when a September running run is completed on October 1", async () => {
    const f = await fixture("COMPLETE");
    const september = await batch(f, SEPTEMBER, "SEP");
    const october = await batch(f, OCTOBER, "OCT");
    const running = await run(f, "RUNNING", "2025-09-29T08:00:00.000Z", null);
    expect(await assignments(running.id)).toEqual([]);

    await updateProductionRun(ctx, running.id, {
      expectedVersion: running.version,
      status: "complete",
      endTime: new Date("2025-10-01T00:00:00.000Z"),
      biocharStorageLocationId: f.outputBinId,
      biocharOutputKg: BIOCHAR_WET_KG,
      biocharMoisturePercent: MOISTURE_PERCENT,
    });

    expect(await assignments(running.id)).toEqual([{ creditBatchId: october.id }]);
    expect(await memberIds(september.id)).toEqual([]);
  });

  it("still joins September when a run starts and ends in September", async () => {
    const f = await fixture("CONTROL");
    const september = await batch(f, SEPTEMBER, "SEP");
    const october = await batch(f, OCTOBER, "OCT");
    const completed = await run(f, "SEP", "2025-09-30T08:00:00.000Z", "2025-09-30T23:59:59.000Z");

    expect(await memberIds(september.id)).toEqual([completed.id]);
    expect(await memberIds(october.id)).toEqual([]);
  });

  it("auto-includes an existing September-to-October run when creating October", async () => {
    const f = await fixture("CREATE-OCT");
    const completed = await run(f, "CROSS", CROSS_MONTH_START, CROSS_MONTH_END);
    expect(await assignments(completed.id)).toEqual([]);

    const october = await batch(f, OCTOBER, "OCT");

    expect(october.productionRunIds).toEqual([completed.id]);
    expect(await memberIds(october.id)).toEqual([completed.id]);
  });

  it("leaves an existing September-to-October run unassigned when creating September", async () => {
    const f = await fixture("CREATE-SEP");
    const completed = await run(f, "CROSS", CROSS_MONTH_START, CROSS_MONTH_END);

    const september = await batch(f, SEPTEMBER, "SEP");

    expect(september.productionRunIds).toEqual([]);
    expect(await assignments(completed.id)).toEqual([]);
  });

  it("refuses an explicitly requested run ending in October when updating a batch to September", async () => {
    const f = await fixture("UPDATE-SEP");
    // August keeps the run unassigned under both date rules, isolating update
    // validation from create-time and run-completion automatic joining.
    const empty = await batch(f, AUGUST, "EMPTY");
    const completed = await run(f, "CROSS", CROSS_MONTH_START, CROSS_MONTH_END);
    expect(await assignments(completed.id)).toEqual([]);
    const update = updateCreditBatch(ctx, empty.id, {
      expectedVersion: empty.version,
      startDate: new Date("2025-09-01T00:00:00.000Z"),
      endDate: new Date("2025-09-30T00:00:00.000Z"),
      productionRunIds: [completed.id],
    });

    await expect(update).rejects.toBeInstanceOf(SafeError);
    await expect(update).rejects.toThrow(/falls outside the credit batch production window/i);
    expect(await assignments(completed.id)).toEqual([]);
    expect(await getCreditBatchById(ctx, empty.id, { skipPreview: true })).toMatchObject({
      ...AUGUST,
      version: empty.version,
      productionRunIds: [],
    });
  });

  it("accepts an explicitly requested September-to-October run when updating a batch to October", async () => {
    const f = await fixture("UPDATE-OCT");
    const empty = await batch(f, AUGUST, "EMPTY");
    const completed = await run(f, "CROSS", CROSS_MONTH_START, CROSS_MONTH_END);
    expect(await assignments(completed.id)).toEqual([]);

    const updated = await updateCreditBatch(ctx, empty.id, {
      expectedVersion: empty.version,
      startDate: new Date("2025-10-01T00:00:00.000Z"),
      endDate: new Date("2025-10-31T00:00:00.000Z"),
      productionRunIds: [completed.id],
    });

    expect(updated.productionRunIds).toEqual([completed.id]);
    expect(await memberIds(empty.id)).toEqual([completed.id]);
  });

  it("allows an October member to end later in October but refuses an end in November", async () => {
    const f = await fixture("EDIT-MEMBER");
    const completed = await run(f, "CROSS", CROSS_MONTH_START, CROSS_MONTH_END);
    const october = await batch(f, OCTOBER, "OCT");
    // Establish the same member under either implementation. This is fixture
    // setup for the existing-member guard, not a repair of old assignments.
    await db.insert(creditBatchProductionRuns).values({
      organizationId: TEST_ORG_ID,
      creditBatchId: october.id,
      productionRunId: completed.id,
    }).onConflictDoNothing();

    const edited = await updateProductionRun(ctx, completed.id, {
      expectedVersion: completed.version,
      endTime: new Date("2025-10-03T06:00:00.000Z"),
    });
    expect(edited.endTime).toEqual(new Date("2025-10-03T06:00:00.000Z"));
    expect(await memberIds(october.id)).toEqual([completed.id]);

    const refused = updateProductionRun(ctx, completed.id, {
      expectedVersion: edited.version,
      endTime: new Date("2025-11-01T00:00:00.000Z"),
    });
    await expect(refused).rejects.toBeInstanceOf(SafeError);
    await expect(refused).rejects.toThrow(/cannot be edited outside its declared cohort/i);
    expect(await getProductionRunById(ctx, completed.id)).toMatchObject({
      endTime: new Date("2025-10-03T06:00:00.000Z"),
      version: edited.version,
    });
    expect(await assignments(completed.id)).toEqual([{ creditBatchId: october.id }]);
  });

  it("offers a completed run by its end month while returning its start date", async () => {
    const f = await fixture("OPTIONS-COMPLETE");
    const completed = await run(f, "CROSS", CROSS_MONTH_START, CROSS_MONTH_END);

    const october = await getCreditBatchProductionRunOptions(ctx, { facilityId: f.facilityId, ...OCTOBER });
    const september = await getCreditBatchProductionRunOptions(ctx, { facilityId: f.facilityId, ...SEPTEMBER });

    expect(october).toEqual([expect.objectContaining({
      id: completed.id,
      status: "complete",
      date: "2025-09-30",
    })]);
    expect(september).toEqual([]);
  });

  it("offers a running run without an end time only in its start month", async () => {
    const f = await fixture("OPTIONS-RUNNING");
    const running = await run(f, "RUNNING", "2025-09-29T08:00:00.000Z", null);

    const september = await getCreditBatchProductionRunOptions(ctx, { facilityId: f.facilityId, ...SEPTEMBER });
    const october = await getCreditBatchProductionRunOptions(ctx, { facilityId: f.facilityId, ...OCTOBER });

    expect(september).toEqual([expect.objectContaining({
      id: running.id,
      status: "running",
      date: "2025-09-29",
    })]);
    expect(october).toEqual([]);
  });

  it("keeps submitted October members and leaves new October-ending runs unassigned", async () => {
    const f = await fixture("LOCKED");
    const project = await mapToIsometric(f);
    const september = await batch(f, SEPTEMBER, "SEP");
    const october = await batch(f, OCTOBER, "OCT");
    const member = await run(f, "MEMBER", "2025-10-02T08:00:00.000Z", "2025-10-02T12:00:00.000Z");
    expect(await memberIds(october.id)).toEqual([member.id]);

    const chain = await createBiocharApplicationChain({
      tag: `END-${f.code}`,
      facilityId: f.facilityId,
      creditBatchId: october.id,
      certifierProjectId: project.id,
      externalProjectId: project.externalProjectId,
    });
    chains.push(chain);
    const [removal] = await insertRemovalFixture(db, {
      organizationId: TEST_ORG_ID,
      facilityId: f.facilityId,
      provider: "isometric",
      startedOn: OCTOBER.startDate,
      completedOn: OCTOBER.endDate,
    });
    removalIds.push(removal.id);
    await db.insert(creditBatchApplications).values({
      organizationId: TEST_ORG_ID,
      creditBatchId: october.id,
      applicationId: chain.applicationId,
      removalId: removal.id,
      allocatedWetMassKg: BIOCHAR_WET_KG,
      allocatedDryMassKg: BIOCHAR_DRY_KG,
    });
    await db.insert(certificationSubmissions).values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: removal.id,
      version: SUBMISSION_VERSION,
      status: "submitted",
      externalId: `rem_${f.code}`,
      submittedAt: new Date("2025-11-02T12:00:00.000Z"),
      payloadHash: `end-date-${tag}`,
      payloadSnapshot: {},
    });
    expect(await db.transaction(async (tx) => {
      const lockedRemovals = await lockCreditBatchArtifacts(ctx, tx, october.id);
      return isCreditBatchMembershipLockedBySubmission(ctx, tx, october.id, lockedRemovals);
    })).toBe(true);

    const crossing = await run(f, "CROSS", CROSS_MONTH_START, "2025-10-01T06:00:00.000Z");
    const withinOctober = await run(f, "OCT", "2025-10-04T08:00:00.000Z", "2025-10-04T12:00:00.000Z");

    expect.soft(await assignments(crossing.id)).toEqual([]);
    expect.soft(await assignments(withinOctober.id)).toEqual([]);
    expect(await memberIds(october.id)).toEqual([member.id]);
    expect(await memberIds(september.id)).toEqual([]);
  });

  it("flags an October batch spanning a month and keeps earliest-start to latest-end registry inputs", async () => {
    const f = await fixture("SPAN");
    await mapToIsometric(f);
    const october = await batch(f, OCTOBER, "OCT");
    expect(october.certifier).toBe("isometric");
    // Saving remains allowed. The submission/readiness span validator, not
    // membership validation, refuses this batch's actual production span.
    const first = await run(f, "FIRST", "2025-09-29T08:00:00.000Z", "2025-10-01T06:00:00.000Z");
    const latest = await run(f, "LATEST", "2025-10-30T08:00:00.000Z", "2025-10-31T23:59:59.000Z");
    expect.soft((await memberIds(october.id)).sort()).toEqual([first.id, latest.id].sort());

    // The same real DB reader supplies both readiness and registration. No
    // registry client or submission-context mocks are needed at this seam.
    const inputs = await getProductionBatchRegistryInputs(ctx, [october.id]);
    expect(inputs).toHaveLength(1);
    expect.soft(inputs[0]).toMatchObject({
      creditBatchId: october.id,
      ...OCTOBER,
      startedAt: "2025-09-29T08:00:00.000Z",
      endedAt: "2025-10-31T23:59:59.000Z",
      latestEndingRunCode: latest.code,
      runsMissingEndTime: 0,
    });
    const issue = getCreditBatchProductionSpanIssue(inputs[0]);
    expect(issue).toContain(`Production run ${latest.code}`);
    expect(issue).toContain(october.code);
    expect(issue).toContain("one month or more");
    expect(issue).not.toContain(first.code);
  });
});
