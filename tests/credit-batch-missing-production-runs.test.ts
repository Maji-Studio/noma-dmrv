import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applicationOutputAllocations, certificationSubmissions, certifierRemovals, creditBatchApplications, creditBatchProductionRuns, creditBatches,
  emissionEntries, emissionEntryValues, facilities, feedstocks, feedstockTypes, organizations,
  productionRunFeedstocks, productionRuns, reactors, removalTemplateObservations, storageLocations,
} from "@/db/schema";
import { loadCreditBatchesMissingProductionRuns } from "@/data-access/credit-batch-missing-production-runs";
import { readCreditBatchMembershipSubmissionLock, readCreditBatchesMembershipSubmissionLocks } from "@/data-access/credit-batch-certification-lock";
import { buildCreditBatchOpenItems } from "@/lib/credit-batches/open-items";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { cleanupFeedstockFixtureParents, feedstockFixtureValues } from "./helpers/feedstock-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const WET_MASS_KG = 100;
const BIOCHAR_OUTPUT_KG = 30;
const MOISTURE_PERCENT = 10;
const ENTRY_MAGNITUDE = "2";
const SHARED_APPLICATION_WET_MASS_KG = "100";
const SHARED_APPLICATION_DRY_MASS_KG = "95";
const TEMPLATE_ID = "late-runs-template";
const START = "2026-06-09T08:00:00Z";
const END = "2026-06-09T12:00:00Z";
const BEFORE_RUN = new Date("2026-07-01T08:00:00Z");
const RUN_CREATED_AT = new Date("2026-07-01T09:00:00Z");
const AFTER_RUN = new Date("2026-07-01T10:00:00Z");

describe("missing production run detection (real DB)", () => {
  let main: LineageFixture;
  let otherFacility: LineageFixture;
  let foreignOrgId: string;
  let foreignFacilityId: string;
  let foreignReactorId: string;
  let foreignBinId: string;
  const runIds: string[] = [];
  const observationIds: string[] = [];

  beforeEach(async () => {
    await ensureTestOrg();
    main = await createLineageFixture("removal");
    otherFacility = await createLineageFixture("none");
    foreignOrgId = `late-runs-${crypto.randomUUID()}`;
    await db.insert(organizations).values({ id: foreignOrgId, name: "Late run scoping", slug: foreignOrgId });
    const [site] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: foreignOrgId,
      code: "FOREIGN", name: "Foreign facility", timezone: "UTC" }).returning();
    foreignFacilityId = site.id;
    const [reactor] = await db.insert(reactors).values({ organizationId: foreignOrgId, facilityId: site.id,
      code: "FOREIGN", identifier: "Foreign reactor", reactorType: "batch" }).returning();
    foreignReactorId = reactor.id;
    const [bin] = await db.insert(storageLocations).values({ organizationId: foreignOrgId, facilityId: site.id,
      code: "FOREIGN", name: "Foreign output", type: "biochar_bin" }).returning();
    foreignBinId = bin.id;
  });

  afterEach(async () => {
    if (observationIds.length) {
      const entries = db.select({ id: emissionEntries.id }).from(emissionEntries)
        .where(inArray(emissionEntries.observationId, observationIds));
      await db.delete(emissionEntryValues).where(inArray(emissionEntryValues.entryId, entries));
      await db.delete(emissionEntries).where(inArray(emissionEntries.observationId, observationIds));
      await db.delete(removalTemplateObservations).where(inArray(removalTemplateObservations.id, observationIds));
      observationIds.length = 0;
    }
    if (runIds.length) {
      await db.delete(creditBatchProductionRuns).where(inArray(creditBatchProductionRuns.productionRunId, runIds));
      await db.delete(productionRunFeedstocks).where(inArray(productionRunFeedstocks.productionRunId, runIds));
      await db.delete(productionRuns).where(inArray(productionRuns.id, runIds));
      runIds.length = 0;
    }
    // Tests may link the other fixture's application to the main batch too.
    await db.delete(creditBatchApplications).where(and(eq(creditBatchApplications.creditBatchId, main.batchId),
      eq(creditBatchApplications.applicationId, otherFacility.applicationId)));
    await cleanupLineageFixture(otherFacility);
    await cleanupLineageFixture(main);
    await db.delete(feedstocks).where(eq(feedstocks.organizationId, foreignOrgId));
    await cleanupFeedstockFixtureParents(db);
    await db.delete(feedstockTypes).where(eq(feedstockTypes.organizationId, foreignOrgId));
    await db.delete(storageLocations).where(eq(storageLocations.organizationId, foreignOrgId));
    await db.delete(reactors).where(eq(reactors.organizationId, foreignOrgId));
    await db.delete(facilities).where(eq(facilities.organizationId, foreignOrgId));
    await db.delete(organizations).where(eq(organizations.id, foreignOrgId));
  });

  async function run(label: string, overrides: Partial<typeof productionRuns.$inferInsert> = {},
    feedstockIds = [main.feedstockId]) {
    const [row] = await db.insert(productionRuns).values({
      organizationId: ctx.organizationId, facilityId: main.facilityId, reactorId: main.reactorId,
      code: `PR-LATE-${label}-${crypto.randomUUID()}`, status: "complete",
      startTime: new Date(START), endTime: new Date(END), createdAt: RUN_CREATED_AT,
      biocharStorageLocationId: main.biocharBinId,
      biocharOutputKg: BIOCHAR_OUTPUT_KG, biocharMoisturePercent: MOISTURE_PERCENT,
      ...overrides,
    }).returning();
    runIds.push(row.id);
    if (feedstockIds.length) await db.insert(productionRunFeedstocks).values(feedstockIds.map(feedstockId => ({
      organizationId: row.organizationId, productionRunId: row.id, feedstockId, wetMassUsedKg: WET_MASS_KG,
    })));
    return row;
  }

  async function read() {
    return (await loadCreditBatchesMissingProductionRuns(ctx, [main.batchId])).get(main.batchId)!;
  }

  async function todos() {
    return buildCreditBatchOpenItems({ facilityId: main.facilityId,
      creditBatchId: main.batchId, canManage: true, missingProductionRuns: await read() });
  }

  async function entryValues() {
    const [observation] = await db.insert(removalTemplateObservations).values({
      organizationId: ctx.organizationId, provider: "isometric", externalProjectId: "late-runs-project",
      externalTemplateId: TEMPLATE_ID, semanticFingerprint: crypto.randomUUID(), fullFingerprint: crypto.randomUUID(),
      definition: { groups: [] }, enrichment: {}, lineSources: {},
    }).returning();
    observationIds.push(observation.id);
    return { organizationId: ctx.organizationId, creditBatchId: main.batchId,
      removalTemplateId: TEMPLATE_ID, componentId: "diesel", observationId: observation.id,
      inputShape: [], lineRule: "additive" as const, occurredOn: "2026-06-09", createdAt: AFTER_RUN };
  }

  async function sendOtherRemoval() {
    await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId,
      provider: "isometric", submissionType: "removal", localEntityType: "removal",
      localEntityId: otherFacility.removalId, externalId: `late-runs-${crypto.randomUUID()}`,
      version: 1, status: "submitted", submittedAt: new Date("2026-07-02T00:00:00Z") });
  }

  it("scopes runs to the organization, facility and single feedstock, excluding archived, assigned and incomplete runs", async () => {
    const expected = await run("MATCH");
    await run("FACILITY", { facilityId: otherFacility.facilityId, reactorId: otherFacility.reactorId,
      biocharStorageLocationId: otherFacility.biocharBinId });
    await run("FEEDSTOCK", { startTime: new Date("2026-06-10T08:00:00Z"), endTime: new Date("2026-06-10T12:00:00Z") },
      [otherFacility.feedstockId]);
    await run("ARCHIVED", { archivedAt: new Date() });
    const assigned = await run("ASSIGNED", { startTime: new Date("2026-06-11T08:00:00Z"), endTime: new Date("2026-06-11T12:00:00Z") });
    // Membership in any batch excludes the run, even a different cohort.
    await db.insert(creditBatchProductionRuns).values({ organizationId: ctx.organizationId,
      productionRunId: assigned.id, creditBatchId: otherFacility.batchId });
    await run("RUNNING", { status: "running", startTime: new Date("2026-06-12T08:00:00Z"), endTime: null });
    await run("MIXED", { startTime: new Date("2026-06-14T08:00:00Z"), endTime: new Date("2026-06-14T12:00:00Z") },
      [main.feedstockId, otherFacility.feedstockId]);
    await run("EMPTY", { startTime: new Date("2026-06-15T08:00:00Z"), endTime: new Date("2026-06-15T12:00:00Z") }, []);
    const [foreignType] = await db.insert(feedstockTypes).values({ organizationId: foreignOrgId,
      code: "FOREIGN", name: "Foreign feedstock", category: "forestry", usage: "pyrolysis" }).returning();
    const [foreignFeedstock] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
      organizationId: foreignOrgId, facilityId: foreignFacilityId, feedstockTypeId: foreignType.id,
      code: "FOREIGN", massDryKg: WET_MASS_KG,
    })).returning();
    await run("ORG", { organizationId: foreignOrgId, facilityId: foreignFacilityId,
      reactorId: foreignReactorId, biocharStorageLocationId: foreignBinId }, [foreignFeedstock.id]);

    expect((await read()).runs).toEqual([{ id: expected.id, code: expected.code, startDate: "2026-06-09", createdAt: RUN_CREATED_AT, heldByRemovalCode: null }]);
    expect(await loadCreditBatchesMissingProductionRuns({ ...ctx, organizationId: foreignOrgId }, [main.batchId]))
      .toEqual(new Map());
    await expect(loadCreditBatchesMissingProductionRuns({ ...ctx, organizationId: "" }, [main.batchId])).rejects.toThrow();
  });

  it("includes both facility-local boundary days using the end day, and returns the start day", async () => {
    await db.update(facilities).set({ timezone: "Africa/Dar_es_Salaam" }).where(eq(facilities.id, main.facilityId));
    const first = await run("FIRST", { startTime: new Date("2026-05-31T20:00:00Z"), endTime: new Date("2026-05-31T21:00:00Z") });
    const last = await run("LAST", { startTime: new Date("2026-06-30T20:00:00Z"), endTime: new Date("2026-06-30T20:59:59Z") });
    await run("BEFORE", { startTime: new Date("2026-05-31T19:00:00Z"), endTime: new Date("2026-05-31T20:59:59Z") });
    await run("AFTER", { startTime: new Date("2026-06-30T20:30:00Z"), endTime: new Date("2026-06-30T21:00:00Z") });
    const localStart = await run("LOCAL", { startTime: new Date("2026-06-08T22:00:00Z"), endTime: new Date("2026-06-09T01:00:00Z") });
    expect((await read()).runs).toEqual([
      { id: first.id, code: first.code, startDate: "2026-05-31", createdAt: RUN_CREATED_AT, heldByRemovalCode: null },
      { id: last.id, code: last.code, startDate: "2026-06-30", createdAt: RUN_CREATED_AT, heldByRemovalCode: null },
      { id: localStart.id, code: localStart.code, startDate: "2026-06-09", createdAt: RUN_CREATED_AT, heldByRemovalCode: null },
    ]);
  });

  it("agrees with the read-only submission lock and omits unheld batches", async () => {
    await db.update(creditBatchApplications).set({ removalId: null })
      .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId),
        eq(creditBatchApplications.creditBatchId, otherFacility.batchId)));
    await run("LOCKED");
    await run("UNLOCKED", { facilityId: otherFacility.facilityId, reactorId: otherFacility.reactorId,
      biocharStorageLocationId: otherFacility.biocharBinId }, [otherFacility.feedstockId]);
    expect(await readCreditBatchMembershipSubmissionLock(ctx, db, main.batchId)).toBe(true);
    expect(await readCreditBatchMembershipSubmissionLock(ctx, db, otherFacility.batchId)).toBe(false);
    const result = await loadCreditBatchesMissingProductionRuns(ctx, [main.batchId, otherFacility.batchId]);
    expect([...result.keys()]).toEqual([main.batchId]);
    expect(result.get(main.batchId)?.sentRemovalCodes).toHaveLength(1);
    await db.delete(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.localEntityId, main.removalId)));
    const [holder] = await db.select({ code: certifierRemovals.code }).from(certifierRemovals)
      .where(eq(certifierRemovals.id, main.removalId));
    expect(await read()).toMatchObject({ sentRemovalCodes: [], heldRemovalCodes: [holder.code] });
    expect(await loadCreditBatchesMissingProductionRuns(ctx, [])).toEqual(new Map());
  });

  it("finds only fitting runs for an unsent held batch and names its holder", async () => {
    await db.delete(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.localEntityId, main.removalId)));
    const fitting = await run("HELD-MATCH");
    await run("HELD-WRONG-TYPE", { startTime: new Date("2026-06-10T08:00:00Z"), endTime: new Date("2026-06-10T12:00:00Z") },
      [otherFacility.feedstockId]);
    await run("HELD-OUTSIDE", { startTime: new Date("2026-07-01T08:00:00Z"), endTime: new Date("2026-07-01T12:00:00Z") });
    const [holder] = await db.select({ code: certifierRemovals.code }).from(certifierRemovals)
      .where(eq(certifierRemovals.id, main.removalId));
    expect(await read()).toEqual({ sentRemovalCodes: [], heldRemovalCodes: [holder.code],
      batchStartDate: "2026-06-01", manualEntries: [],
      runs: [{ id: fitting.id, code: fitting.code, startDate: "2026-06-09", createdAt: RUN_CREATED_AT, heldByRemovalCode: null }] });
    expect((await todos()).check).toEqual([{
      id: `missing-production-run:${fitting.id}`,
      productionRun: { id: fitting.id, code: fitting.code },
      title: `${fitting.code} is not in this credit batch yet`,
      titleAfterCode: " is not in this credit batch yet",
      detail: `Its emissions are not counted in ${holder.code}.`,
      target: { tab: "overview", rowId: "batch-details" },
    }]);
    await db.insert(creditBatchApplications).values({ organizationId: ctx.organizationId,
      creditBatchId: main.batchId, applicationId: otherFacility.applicationId,
      allocatedWetMassKg: WET_MASS_KG, allocatedDryMassKg: BIOCHAR_OUTPUT_KG,
      removalId: otherFacility.removalId });
    const holders = await db.select({ code: certifierRemovals.code }).from(certifierRemovals)
      .where(inArray(certifierRemovals.id, [main.removalId, otherFacility.removalId]));
    expect((await read()).heldRemovalCodes).toEqual(holders.map(row => row.code).sort());
    expect(await loadCreditBatchesMissingProductionRuns({ ...ctx, organizationId: foreignOrgId }, [main.batchId]))
      .toEqual(new Map());
  });

  it.each(["200_year", "1000_year"] as const)("reports held allocations through another batch according to %s Add run policy", async durabilityOption => {
    await db.delete(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.localEntityId, main.removalId)));
    await db.update(facilities).set({ durabilityOption }).where(and(
      eq(facilities.id, main.facilityId), eq(facilities.organizationId, ctx.organizationId),
    ));
    const fitting = await run("HELD-ALLOCATION");
    const ordinary = await run("ORDINARY", { startTime: new Date("2026-06-10T08:00:00Z"), endTime: new Date("2026-06-10T12:00:00Z") });
    const [originalShare] = await db.select().from(applicationOutputAllocations)
      .where(eq(applicationOutputAllocations.applicationId, otherFacility.applicationId));
    // Half the Application stays in its held slice; the missed run supplies the rest.
    await db.update(applicationOutputAllocations).set({
      wetMassKg: SHARED_APPLICATION_WET_MASS_KG, dryMassKg: SHARED_APPLICATION_DRY_MASS_KG,
    }).where(eq(applicationOutputAllocations.id, originalShare.id));
    await db.update(creditBatchApplications).set({
      allocatedWetMassKg: Number(SHARED_APPLICATION_WET_MASS_KG), allocatedDryMassKg: Number(SHARED_APPLICATION_DRY_MASS_KG),
    }).where(eq(creditBatchApplications.creditBatchId, otherFacility.batchId));
    const [addedShare] = await db.insert(applicationOutputAllocations).values({
      ...originalShare, id: crypto.randomUUID(), productionRunId: fitting.id,
      wetMassKg: SHARED_APPLICATION_WET_MASS_KG, dryMassKg: SHARED_APPLICATION_DRY_MASS_KG,
    }).returning();
    try {
      const [holder] = await db.select({ code: certifierRemovals.code }).from(certifierRemovals)
        .where(eq(certifierRemovals.id, otherFacility.removalId));
      const missing = await read();
      expect(missing.runs).toEqual([
        { id: fitting.id, code: fitting.code, startDate: "2026-06-09", createdAt: RUN_CREATED_AT,
          heldByRemovalCode: durabilityOption === "200_year" ? holder.code : null },
        { id: ordinary.id, code: ordinary.code, startDate: "2026-06-10", createdAt: RUN_CREATED_AT, heldByRemovalCode: null },
      ]);
      const [ownHolder] = await db.select({ code: certifierRemovals.code }).from(certifierRemovals)
        .where(eq(certifierRemovals.id, main.removalId));
      await db.insert(creditBatchApplications).values({ organizationId: ctx.organizationId,
        creditBatchId: main.batchId, applicationId: otherFacility.applicationId,
        allocatedWetMassKg: WET_MASS_KG, allocatedDryMassKg: BIOCHAR_OUTPUT_KG,
        removalId: main.removalId });
      expect((await read()).runs).toEqual(missing.runs.map(run => ({ ...run,
        heldByRemovalCode: run.id === fitting.id ? ownHolder.code : null })));
      // A Sent batch uses its existing entry guidance without the held-allocation read.
      await sendOtherRemoval();
      await db.update(creditBatchApplications).set({ removalId: otherFacility.removalId }).where(and(
        eq(creditBatchApplications.creditBatchId, main.batchId),
        eq(creditBatchApplications.applicationId, otherFacility.applicationId),
      ));
      expect((await read()).runs).toEqual(missing.runs.map(run => ({ ...run, heldByRemovalCode: null })));
    } finally {
      await db.delete(applicationOutputAllocations).where(eq(applicationOutputAllocations.id, addedShare.id));
    }
  });

  it("shows a held run with a later diesel-only same-day entry after clearing it while Sent", async () => {
    const fitting = await run("HELD-COVERED");
    const values = await entryValues();
    const [entry] = await db.insert(emissionEntries).values({ ...values, kind: "value" }).returning();
    await db.insert(emissionEntryValues).values({ organizationId: ctx.organizationId, entryId: entry.id,
      inputKey: "diesel", magnitude: ENTRY_MAGNITUDE, unit: "L" });
    expect((await todos()).check).toEqual([]);
    await db.delete(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.localEntityId, main.removalId)));
    expect(await read()).toMatchObject({ sentRemovalCodes: [], heldRemovalCodes: [expect.any(String)],
      runs: [{ id: fitting.id, heldByRemovalCode: null }], manualEntries: [{ occurredOn: values.occurredOn, createdAt: AFTER_RUN }] });
    const [holder] = await db.select({ code: certifierRemovals.code }).from(certifierRemovals)
      .where(eq(certifierRemovals.id, main.removalId));
    expect((await todos()).check).toEqual([{
      id: `missing-production-run:${fitting.id}`, productionRun: { id: fitting.id, code: fitting.code },
      title: `${fitting.code} is not in this credit batch yet`, titleAfterCode: " is not in this credit batch yet",
      detail: `Its emissions are not counted in ${holder.code}. If the Emissions entry dated Jun 9, 2026 already records them, delete it when you add the run.`,
      sameDayEntry: true,
      target: { tab: "overview", rowId: "batch-details" },
    }]);
  });

  it.each(["FAILED_VERIFICATION", "DRAFT"])("shows missing runs for a returned %s holder without authorizing a write", async remoteStatus => {
    await cleanupLineageFixture(main);
    main = await createLineageFixture("ghgStatement");
    const externalId = `returned-run-${crypto.randomUUID()}`;
    await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId,
      provider: "isometric", submissionType: "removal", localEntityType: "removal",
      localEntityId: main.removalId, externalId, version: 1, status: "submitted",
      submittedAt: new Date("2026-06-16T00:00:00Z") });
    await db.update(certificationSubmissions).set({ metadata: {
      remoteStatus, submittedToVerifierAt: "2026-06-17T00:00:00Z", removalIds: [externalId],
    } }).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.localEntityId, main.ghgStatementId!)));
    const fitting = await run("RETURNED");
    const [holder] = await db.select({ code: certifierRemovals.code }).from(certifierRemovals)
      .where(eq(certifierRemovals.id, main.removalId));
    expect(await read()).toMatchObject({ sentRemovalCodes: [], heldRemovalCodes: [holder.code],
      runs: [{ id: fitting.id }] });
    expect((await todos()).check.map(item => item.id)).toEqual([`missing-production-run:${fitting.id}`]);
    // The mutation guard still requires a fresh registry read to reopen membership.
    expect(await readCreditBatchMembershipSubmissionLock(ctx, db, main.batchId)).toBe(true);
    await db.update(certificationSubmissions).set({ metadata: {
      remoteStatus: "AWAITING_VERIFICATION", submittedToVerifierAt: "2026-06-17T00:00:00Z", removalIds: [externalId],
    } }).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.localEntityId, main.ghgStatementId!)));
    expect((await read()).sentRemovalCodes).toEqual([holder.code]);
    expect((await todos()).check.map(item => item.id)).toEqual([`late-production-run:${fitting.id}`]);
  });

  it("keeps the Check for older entries sent by either locking Removal on the run day", async () => {
    const lateRun = await run("ALREADY-SENT");
    await sendOtherRemoval();
    await db.insert(creditBatchApplications).values({ organizationId: ctx.organizationId,
      creditBatchId: main.batchId, applicationId: otherFacility.applicationId,
      allocatedWetMassKg: WET_MASS_KG, allocatedDryMassKg: BIOCHAR_OUTPUT_KG,
      removalId: otherFacility.removalId });
    const locks = await readCreditBatchesMembershipSubmissionLocks(ctx, db, [main.batchId]);
    const removalCodes = await db.select({ code: certifierRemovals.code }).from(certifierRemovals)
      .where(inArray(certifierRemovals.id, [main.removalId, otherFacility.removalId]));
    expect(locks.get(main.batchId)).toEqual(removalCodes.map(removal => removal.code).sort());
    expect(await readCreditBatchMembershipSubmissionLock(ctx, db, main.batchId)).toBe(true);
    const values = await entryValues();
    for (const removalId of [main.removalId, otherFacility.removalId]) {
      await db.insert(emissionEntries).values({ ...values, kind: "value", sentByRemovalId: removalId, createdAt: BEFORE_RUN });
      expect((await todos()).check.map(item => item.id)).toEqual([`late-production-run:${lateRun.id}`]);
    }
  });

  it.each([BEFORE_RUN, RUN_CREATED_AT])("keeps the Check for an unsent same-day entry created at %s", async createdAt => {
    const lateRun = await run("OLDER-ENTRY");
    const values = await entryValues();
    await db.insert(emissionEntries).values({ ...values, kind: "value", createdAt });
    expect((await todos()).check.map(item => item.id)).toEqual([`late-production-run:${lateRun.id}`]);
  });

  it("keeps the Check for an older reserved entry during an interrupted send", async () => {
    const lateRun = await run("RESERVED");
    const [submission] = await db.update(certificationSubmissions).set({ status: "draft", submittedAt: null })
      .where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
        eq(certificationSubmissions.localEntityId, main.removalId))).returning();
    const values = await entryValues();
    await db.insert(emissionEntries).values({ ...values, kind: "value", createdAt: BEFORE_RUN,
      sendReservedBySubmissionId: submission.id });
    expect(await readCreditBatchMembershipSubmissionLock(ctx, db, main.batchId)).toBe(true);
    expect((await todos()).check.map(item => item.id)).toEqual([`late-production-run:${lateRun.id}`]);
  });

  it("stays cleared after the late entry is sent by the batch's next Removal", async () => {
    await run("NEXT-REMOVAL");
    const values = await entryValues();
    const [entry] = await db.insert(emissionEntries).values({ ...values, kind: "value" }).returning();
    expect((await todos()).check).toEqual([]);
    await db.insert(creditBatchApplications).values({ organizationId: ctx.organizationId,
      creditBatchId: main.batchId, applicationId: otherFacility.applicationId,
      allocatedWetMassKg: WET_MASS_KG, allocatedDryMassKg: BIOCHAR_OUTPUT_KG,
      removalId: otherFacility.removalId });
    await sendOtherRemoval();
    await db.update(emissionEntries).set({ sentByRemovalId: otherFacility.removalId })
      .where(eq(emissionEntries.id, entry.id));
    expect((await read()).sentRemovalCodes).toHaveLength(2);
    expect((await todos()).check).toEqual([]);
  });

  it("keeps a clamped run's Check when a single-rule entry is dated at the batch start", async () => {
    const lateRun = await run("CLAMPED", { startTime: new Date("2026-05-31T20:00:00Z"),
      endTime: new Date("2026-06-01T01:00:00Z") });
    const values = await entryValues();
    await db.insert(emissionEntries).values({ ...values, kind: "value", lineRule: "single", occurredOn: "2026-06-01" });
    expect((await read()).manualEntries).toEqual([]);
    expect((await todos()).check).toMatchObject([{ id: `late-production-run:${lateRun.id}`,
      detail: "It is not in this credit batch. Record its diesel and power on the Emissions tab, dated Jun 1, 2026." }]);
    await db.insert(emissionEntries).values({ ...values, kind: "value", occurredOn: "2026-06-01" });
    expect((await todos()).check).toEqual([]);
  });

  it("resolves with an additive entry carried and sent by a Removal outside this batch's lock set", async () => {
    await run("CARRIED");
    await sendOtherRemoval();
    const values = await entryValues();
    await db.insert(emissionEntries).values({ ...values, kind: "value", sentByRemovalId: otherFacility.removalId });
    // The receiver locks another batch in this same read, but not the entry's origin batch.
    const result = await loadCreditBatchesMissingProductionRuns(ctx, [main.batchId, otherFacility.batchId]);
    expect([...result.keys()].sort()).toEqual([main.batchId, otherFacility.batchId].sort());
    expect(result.get(main.batchId)?.manualEntries).toEqual([{ occurredOn: "2026-06-09", createdAt: AFTER_RUN }]);
    expect(buildCreditBatchOpenItems({ facilityId: main.facilityId, creditBatchId: main.batchId,
      canManage: true, missingProductionRuns: result.get(main.batchId) }).check).toEqual([]);
  });

  it("resolves with a new undeleted additive value on the start day, even without a usable template", async () => {
    const lateRun = await run("ENTRY");
    const values = await entryValues();
    await db.insert(emissionEntries).values([
      { ...values, componentId: "recorded-zero", kind: "zero", confirmedForRemovalId: main.removalId },
      { ...values, componentId: "deleted", kind: "value", deletedAt: new Date() },
      { ...values, componentId: "other-day", kind: "value", occurredOn: "2026-06-10" },
      { ...values, componentId: "other-batch", kind: "value", creditBatchId: otherFacility.batchId },
    ]);
    expect((await todos()).check.map(item => item.id)).toEqual([`late-production-run:${lateRun.id}`]);
    const [entry] = await db.insert(emissionEntries).values({ ...values, kind: "value" }).returning();
    await db.insert(emissionEntryValues).values({ organizationId: ctx.organizationId, entryId: entry.id,
      inputKey: "diesel", magnitude: ENTRY_MAGNITUDE, unit: "L" });
    expect((await todos()).check).toEqual([]);
    await db.update(emissionEntries).set({ deletedAt: new Date() }).where(eq(emissionEntries.id, entry.id));
    expect((await todos()).check).toHaveLength(1);
    // Detection and resolution never attach or credit the run.
    expect(await db.select().from(creditBatchProductionRuns)
      .where(eq(creditBatchProductionRuns.productionRunId, lateRun.id))).toEqual([]);
    expect(await db.select().from(creditBatchApplications).where(eq(creditBatchApplications.creditBatchId, main.batchId)))
      .toHaveLength(1);
    expect(await db.select().from(creditBatches).where(eq(creditBatches.id, main.batchId)))
      .toHaveLength(1);
  });
});
