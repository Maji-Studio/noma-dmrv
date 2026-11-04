import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents, certificationSubmissions, certifierProjects, certifierRemovals,
  creditBatchApplications, creditBatchProductionRuns, creditBatches, facilities,
  feedstocks, feedstockTypes, organizations, productionProcesses,
  productionRunFeedstockDraws, productionRunFeedstocks, productionRuns, reactors, storageLocations,
} from "@/db/schema";
import { createCreditBatch } from "@/data-access/credit-batches";
import { createProductionRun, updateProductionRun } from "@/data-access/production-runs";
import { getProductionRunCreditBatchPreview } from "@/data-access/production-run-credit-batch-preview";
import { productionRunCreditBatchPreviewSchema, type ProductionRunCreditBatchPreviewInput } from "@/schemas/production-run-credit-batch-preview";
import { cleanupFeedstockFixtureParents, feedstockFixtureValues } from "./helpers/feedstock-fixture";
import { createProductionRunOutputBin } from "./helpers/production-run-output-bin";
import { createBiocharApplicationChain } from "./helpers/biochar-application-chain";
import { cleanupOutputFixtureParents } from "./helpers/output-contract-fixtures";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

const TEST_USER_ID = "test-user-run-batch-preview";
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
const CROSS_MONTH_START = "2025-09-30T10:00:00.000Z";
const CROSS_MONTH_END = "2025-10-02T06:00:00.000Z";

describe("production run credit batch preview", () => {
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

  const otherOrgId = `org_preview_${tag}`;
  beforeAll(async () => {
    await ensureTestOrg();
    await db.insert(organizations).values({ id: otherOrgId, name: `Preview ${tag}`, slug: `preview-${tag.toLowerCase()}` });
  });

  // Each case owns its cohort, so identical past dates and failed assertions
  // cannot leave assignments or reactor windows that affect another case.
  async function fixture(label: string, timezone = "UTC") {
    const code = `${label}-${tag}`;
    const [facility] = await db.insert(facilities).values({
      ...TEST_SITE_POSITION,
      organizationId: TEST_ORG_ID,
      timezone,
      code: `FAC-PREVIEW-${code}`,
      name: `Preview facility ${code}`,
    }).returning({ id: facilities.id });
    facilityIds.push(facility.id);
    const outputBinId = await createProductionRunOutputBin(TEST_ORG_ID, facility.id);
    storageLocationIds.push(outputBinId);
    const [reactor] = await db.insert(reactors).values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      code: `RE-PREVIEW-${code}`,
      identifier: `Preview reactor ${code}`,
      reactorType: "auger",
    }).returning({ id: reactors.id });
    reactorIds.push(reactor.id);
    const [feedstockType] = await db.insert(feedstockTypes).values({
      organizationId: TEST_ORG_ID,
      code: `FT-PREVIEW-${code}`,
      name: `Preview feedstock ${code}`,
      category: "forestry",
      usage: "pyrolysis",
    }).returning({ id: feedstockTypes.id });
    feedstockTypeIds.push(feedstockType.id);
    const [bin] = await db.insert(storageLocations).values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      code: `BIN-PREVIEW-${code}`,
      name: `Preview feedstock bin ${code}`,
      type: "feedstock_bin",
    }).returning({ id: storageLocations.id });
    storageLocationIds.push(bin.id);
    const [feedstock] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      storageLocationId: bin.id,
      code: `FS-PREVIEW-${code}`,
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
      code: `CB-PREVIEW-${label}-${f.code}`,
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
      code: `PR-PREVIEW-${label}-${f.code}`,
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

  async function assignments(runId: string) {
    return db.select({ creditBatchId: creditBatchProductionRuns.creditBatchId })
      .from(creditBatchProductionRuns)
      .where(eq(creditBatchProductionRuns.productionRunId, runId));
  }

  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.id, otherOrgId));
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

  function input(f: Fixture, patch: Partial<ProductionRunCreditBatchPreviewInput> = {}): ProductionRunCreditBatchPreviewInput {
    return {
      facilityId: f.facilityId,
      productionRunId: null,
      status: "complete",
      startTime: CROSS_MONTH_START,
      endTime: CROSS_MONTH_END,
      feedstockStorageLocationIds: [f.storageLocationId],
      ...patch,
    };
  }

  function preview(f: Fixture, patch: Partial<ProductionRunCreditBatchPreviewInput> = {}) {
    return getProductionRunCreditBatchPreview(ctx, productionRunCreditBatchPreviewSchema.parse(input(f, patch)));
  }

  it("previews October by end day and agrees with creating a complete run", async () => {
    const f = await fixture("MATCH");
    await batch(f, SEPTEMBER, "SEP");
    const october = await batch(f, OCTOBER, "OCT");
    const result = await preview(f);
    expect(result).toMatchObject({
      state: "match", batch: { id: october.id }, expected: false,
      basis: {
        day: "2025-10-02", dayBasis: "end", timeZone: "UTC",
        facilityName: `Preview facility ${f.code}`, feedstockTypeName: `Preview feedstock ${f.code}`,
      },
    });
    const saved = await run(f, "MATCH", CROSS_MONTH_START, CROSS_MONTH_END);
    expect(await assignments(saved.id)).toEqual([{ creditBatchId: october.id }]);
  });

  it("uses the facility calendar across the UTC month boundary, including on update", async () => {
    const f = await fixture("ZONE", "America/Los_Angeles");
    const september = await batch(f, SEPTEMBER, "SEP");
    await batch(f, OCTOBER, "OCT");
    const start = "2025-09-30T20:00:00.000Z";
    const end = "2025-10-01T06:00:00.000Z"; // September 30 at 23:00 locally.
    const running = await run(f, "ZONE", start, null);
    expect(await preview(f, { productionRunId: running.id, startTime: start, endTime: end })).toMatchObject({
      state: "match", batch: { id: september.id }, expected: false,
      basis: { day: "2025-09-30", dayBasis: "end", timeZone: "America/Los_Angeles" },
    });
    await updateProductionRun(ctx, running.id, {
      expectedVersion: running.version, status: "complete", endTime: new Date(end),
      biocharStorageLocationId: f.outputBinId, biocharOutputKg: BIOCHAR_WET_KG,
      biocharMoisturePercent: MOISTURE_PERCENT,
    });
    expect(await assignments(running.id)).toEqual([{ creditBatchId: september.id }]);
  });

  it("makes running membership provisional, using start until an end is entered", async () => {
    const f = await fixture("RUNNING");
    const september = await batch(f, SEPTEMBER, "SEP");
    const october = await batch(f, OCTOBER, "OCT");
    expect(await preview(f, { status: "running", endTime: null })).toMatchObject({
      state: "match", batch: { id: september.id }, expected: true,
      basis: { day: "2025-09-30", dayBasis: "start" },
    });
    expect(await preview(f, { status: "running" })).toMatchObject({
      state: "match", batch: { id: october.id }, expected: true,
      basis: { day: "2025-10-02", dayBasis: "end" },
    });
    const saved = await run(f, "RUNNING", CROSS_MONTH_START, null);
    expect(await assignments(saved.id)).toEqual([]);
  });

  it("previews no match and agrees with saving without membership", async () => {
    const f = await fixture("NONE");
    await batch(f, SEPTEMBER, "SEP");
    expect(await preview(f)).toMatchObject({ state: "no-match", expected: false });
    const saved = await run(f, "NONE", CROSS_MONTH_START, CROSS_MONTH_END);
    expect(await assignments(saved.id)).toEqual([]);
  });

  it("reports every legacy overlapping batch and saves without membership", async () => {
    const f = await fixture("AMBIG");
    const first = await batch(f, OCTOBER, "OCT");
    // Deliberately bypass cohort overlap validation to represent legacy rows.
    const [second] = await db.insert(creditBatches).values({
      organizationId: TEST_ORG_ID, facilityId: f.facilityId,
      feedstockTypeId: f.feedstockTypeId, productionProcessId: first.productionProcessId,
      code: `CB-PREVIEW-LEGACY-${f.code}`, ...OCTOBER,
    }).returning();
    creditBatchIds.push(second.id);
    const result = await preview(f);
    expect(result.state).toBe("ambiguous");
    if (result.state !== "ambiguous") throw new Error("Expected ambiguous preview");
    expect(result.expected).toBe(false);
    expect(result.batches.map(b => b.id)).toEqual([first.id, second.id].sort());
    const saved = await run(f, "AMBIG", CROSS_MONTH_START, CROSS_MONTH_END);
    expect(await assignments(saved.id)).toEqual([]);
  });

  async function secondBin(f: Fixture) {
    const [type] = await db.insert(feedstockTypes).values({
      organizationId: TEST_ORG_ID, code: `FT-PREVIEW-SECOND-${f.code}`,
      name: `Preview second feedstock ${f.code}`, category: "forestry", usage: "pyrolysis",
    }).returning();
    feedstockTypeIds.push(type.id);
    const [bin] = await db.insert(storageLocations).values({
      organizationId: TEST_ORG_ID, facilityId: f.facilityId, feedstockTypeId: type.id,
      code: `BIN-PREVIEW-SECOND-${f.code}`, name: `Preview second bin ${f.code}`, type: "feedstock_bin",
    }).returning();
    storageLocationIds.push(bin.id);
    return bin;
  }

  it("reports two distinct source-bin types, ignoring duplicate selections", async () => {
    const f = await fixture("MIXED");
    const bin = await secondBin(f);
    expect(await preview(f, { feedstockStorageLocationIds: [f.storageLocationId, bin.id, bin.id] })).toEqual({
      state: "mixed-feedstock", feedstockTypeCount: 2,
    });
  });

  it("returns the first incomplete input, and ignores a missing edit ID", async () => {
    const f = await fixture("INCOMPLETE");
    expect(await preview(f, { facilityId: null })).toEqual({ state: "incomplete", missing: "facility" });
    expect(await preview(f, { facilityId: crypto.randomUUID() })).toEqual({ state: "incomplete", missing: "facility" });
    expect(await preview(f, { feedstockStorageLocationIds: [] })).toEqual({ state: "incomplete", missing: "feedstock" });
    expect(await preview(f, { endTime: null })).toEqual({ state: "incomplete", missing: "end" });
    expect(await preview(f, { status: "running", startTime: null, endTime: null })).toEqual({ state: "incomplete", missing: "start" });
    expect(await preview(f, { productionRunId: crypto.randomUUID() })).toMatchObject({ state: "no-match" });
  });

  it("ignores foreign-facility, archived, unrestricted, non-feedstock and non-pyrolysis bins", async () => {
    const f = await fixture("BINS");
    const foreign = await fixture("FOREIGN-BIN");
    const blend = await secondBin(f);
    await db.update(feedstockTypes).set({ usage: "blend" }).where(eq(feedstockTypes.id, blend.feedstockTypeId!));
    const [archived] = await db.insert(storageLocations).values({
      organizationId: TEST_ORG_ID, facilityId: f.facilityId, feedstockTypeId: f.feedstockTypeId,
      code: `BIN-PREVIEW-ARCHIVED-${f.code}`, name: `Preview archived ${f.code}`,
      type: "feedstock_bin", archivedAt: new Date(),
    }).returning();
    storageLocationIds.push(archived.id);
    const [unrestricted] = await db.insert(storageLocations).values({
      organizationId: TEST_ORG_ID, facilityId: f.facilityId,
      code: `BIN-PREVIEW-UNRESTRICTED-${f.code}`, name: `Preview unrestricted ${f.code}`, type: "feedstock_bin",
    }).returning();
    storageLocationIds.push(unrestricted.id);
    const invalidIds = [foreign.storageLocationId, blend.id, archived.id, unrestricted.id, f.outputBinId, crypto.randomUUID()];
    expect(await preview(f, { feedstockStorageLocationIds: invalidIds })).toEqual({ state: "incomplete", missing: "feedstock" });
    expect(await preview(f, { feedstockStorageLocationIds: [...invalidIds, f.storageLocationId] })).toMatchObject({ state: "no-match" });
  });

  it.each(["failed", "cancelled"] as const)("never joins for %s", async (status) => {
    const f = await fixture(status.toUpperCase());
    await batch(f, OCTOBER, "OCT");
    expect(await preview(f, { status, facilityId: null })).toEqual({ state: "not-applicable", status });
  });

  it("preserves a member and reports edited cohort conflicts before searching", async () => {
    const f = await fixture("MEMBER");
    const october = await batch(f, OCTOBER, "OCT");
    const saved = await run(f, "MEMBER", CROSS_MONTH_START, CROSS_MONTH_END);
    const edit = { productionRunId: saved.id };
    expect(await preview(f, edit)).toMatchObject({ state: "member", batch: { id: october.id }, conflict: null, basis: { day: "2025-10-02" } });
    expect(await preview(f, { ...edit, endTime: "2025-11-01T06:00:00.000Z" })).toMatchObject({ state: "member", conflict: "outside-window" });
    expect(await preview(f, { ...edit, status: "running", facilityId: null })).toMatchObject({ state: "member", conflict: "reopen", basis: null });
    expect(await preview(f, { ...edit, status: "failed" })).toMatchObject({ state: "member", conflict: "reopen" });
    const bin = await secondBin(f);
    expect(await preview(f, { ...edit, feedstockStorageLocationIds: [bin.id] })).toMatchObject({ state: "member", conflict: "feedstock" });
    expect(await preview(f, { ...edit, feedstockStorageLocationIds: [bin.id, f.storageLocationId] })).toMatchObject({ state: "member", conflict: "feedstock", basis: null });
    const other = await fixture("MEMBER-FACILITY");
    expect(await preview(f, { ...edit, facilityId: other.facilityId, feedstockStorageLocationIds: [other.storageLocationId] })).toMatchObject({ state: "member", conflict: "facility" });
    expect(await preview(f, { ...edit, endTime: null })).toMatchObject({ state: "member", conflict: null, basis: null });
    expect(await preview(f, { ...edit, feedstockStorageLocationIds: [] })).toMatchObject({ state: "member", conflict: null, basis: null });
  });

  it("never discloses a foreign organization's facility, bins, member or batch", async () => {
    const f = await fixture("ORG");
    await batch(f, OCTOBER, "OCT");
    const saved = await run(f, "ORG", CROSS_MONTH_START, CROSS_MONTH_END);
    const foreignCtx = { ...ctx, organizationId: otherOrgId };
    const result = await getProductionRunCreditBatchPreview(foreignCtx,
      productionRunCreditBatchPreviewSchema.parse(input(f, { productionRunId: saved.id })));
    expect(result).toEqual({ state: "incomplete", missing: "facility" });
  });

  it("previews a submitted Removal lock and agrees with saving without membership", async () => {
    const f = await fixture("LOCKED");
    const project = await mapToIsometric(f);
    const october = await batch(f, OCTOBER, "OCT");
    const chain = await createBiocharApplicationChain({
      tag: `PREVIEW-${f.code}`, facilityId: f.facilityId, creditBatchId: october.id,
      certifierProjectId: project.id, externalProjectId: project.externalProjectId,
    });
    chains.push(chain);
    const [removal] = await insertRemovalFixture(db, {
      organizationId: TEST_ORG_ID, facilityId: f.facilityId, provider: "isometric",
      startedOn: OCTOBER.startDate, completedOn: OCTOBER.endDate,
    });
    removalIds.push(removal.id);
    await db.insert(creditBatchApplications).values({
      organizationId: TEST_ORG_ID, creditBatchId: october.id, applicationId: chain.applicationId,
      removalId: removal.id, allocatedWetMassKg: BIOCHAR_WET_KG, allocatedDryMassKg: BIOCHAR_DRY_KG,
    });
    await db.insert(certificationSubmissions).values({
      organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
      localEntityType: "removal", localEntityId: removal.id, version: SUBMISSION_VERSION,
      status: "submitted", externalId: `rem_preview_${f.code}`,
      submittedAt: new Date("2025-11-02T12:00:00.000Z"), payloadHash: `preview-${tag}`, payloadSnapshot: {},
    });
    expect(await preview(f)).toMatchObject({ state: "locked", batch: { id: october.id }, expected: false });
    expect(await preview(f, { status: "running" })).toMatchObject({ state: "locked", expected: true });
    const saved = await run(f, "LOCKED", CROSS_MONTH_START, CROSS_MONTH_END);
    expect(await assignments(saved.id)).toEqual([]);
  });
});
