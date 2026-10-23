import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  certificationSubmissions, creditBatchApplications, creditBatchProductionRuns, creditBatches,
  emissionEntries, emissionEntryValues, facilities, feedstocks, feedstockTypes, organizations,
  productionRunFeedstocks, productionRuns, reactors, removalTemplateObservations, storageLocations,
} from "@/db/schema";
import { loadCreditBatchesLateProductionRuns } from "@/data-access/credit-batch-late-production-runs";
import { readCreditBatchMembershipSubmissionLock } from "@/data-access/credit-batch-certification-lock";
import { buildCreditBatchOpenItems } from "@/lib/credit-batches/open-items";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { cleanupFeedstockFixtureParents, feedstockFixtureValues } from "./helpers/feedstock-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const WET_MASS_KG = 100;
const BIOCHAR_OUTPUT_KG = 30;
const MOISTURE_PERCENT = 10;
const ENTRY_MAGNITUDE = "2";
const TEMPLATE_ID = "late-runs-template";
const START = "2026-06-09T08:00:00Z";
const END = "2026-06-09T12:00:00Z";

describe("late production run detection (real DB)", () => {
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
      startTime: new Date(START), endTime: new Date(END),
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
    return (await loadCreditBatchesLateProductionRuns(ctx, [main.batchId])).get(main.batchId)!;
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

    expect((await read()).runs).toEqual([{ id: expected.id, code: expected.code, startDate: "2026-06-09" }]);
    expect(await loadCreditBatchesLateProductionRuns({ ...ctx, organizationId: foreignOrgId }, [main.batchId]))
      .toEqual(new Map());
    await expect(loadCreditBatchesLateProductionRuns({ ...ctx, organizationId: "" }, [main.batchId])).rejects.toThrow();
  });

  it("includes both facility-local boundary days using the end day, and returns the start day", async () => {
    await db.update(facilities).set({ timezone: "Africa/Dar_es_Salaam" }).where(eq(facilities.id, main.facilityId));
    const first = await run("FIRST", { startTime: new Date("2026-05-31T20:00:00Z"), endTime: new Date("2026-05-31T21:00:00Z") });
    const last = await run("LAST", { startTime: new Date("2026-06-30T20:00:00Z"), endTime: new Date("2026-06-30T20:59:59Z") });
    await run("BEFORE", { startTime: new Date("2026-05-31T19:00:00Z"), endTime: new Date("2026-05-31T20:59:59Z") });
    await run("AFTER", { startTime: new Date("2026-06-30T20:30:00Z"), endTime: new Date("2026-06-30T21:00:00Z") });
    const localStart = await run("LOCAL", { startTime: new Date("2026-06-08T22:00:00Z"), endTime: new Date("2026-06-09T01:00:00Z") });
    expect((await read()).runs).toEqual([
      { id: first.id, code: first.code, startDate: "2026-05-31" },
      { id: last.id, code: last.code, startDate: "2026-06-30" },
      { id: localStart.id, code: localStart.code, startDate: "2026-06-09" },
    ]);
  });

  it("agrees with the read-only submission lock and omits unlocked batches", async () => {
    await run("LOCKED");
    await run("UNLOCKED", { facilityId: otherFacility.facilityId, reactorId: otherFacility.reactorId,
      biocharStorageLocationId: otherFacility.biocharBinId }, [otherFacility.feedstockId]);
    expect(await readCreditBatchMembershipSubmissionLock(ctx, db, main.batchId)).toBe(true);
    expect(await readCreditBatchMembershipSubmissionLock(ctx, db, otherFacility.batchId)).toBe(false);
    const result = await loadCreditBatchesLateProductionRuns(ctx, [main.batchId, otherFacility.batchId]);
    expect([...result.keys()]).toEqual([main.batchId]);
    expect(result.get(main.batchId)?.sentRemovalCodes).toHaveLength(1);
    await db.delete(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.localEntityId, main.removalId)));
    expect(await loadCreditBatchesLateProductionRuns(ctx, [main.batchId])).toEqual(new Map());
    expect(await loadCreditBatchesLateProductionRuns(ctx, [])).toEqual(new Map());
  });

  it("resolves only with an undeleted value entry on the start day, even without a usable template", async () => {
    const lateRun = await run("ENTRY");
    const [observation] = await db.insert(removalTemplateObservations).values({
      organizationId: ctx.organizationId, provider: "isometric", externalProjectId: "late-runs-project",
      externalTemplateId: TEMPLATE_ID, semanticFingerprint: crypto.randomUUID(), fullFingerprint: crypto.randomUUID(),
      definition: { groups: [] }, enrichment: {}, lineSources: {},
    }).returning();
    observationIds.push(observation.id);
    const values = { organizationId: ctx.organizationId, creditBatchId: main.batchId,
      removalTemplateId: TEMPLATE_ID, componentId: "diesel", observationId: observation.id,
      inputShape: [], lineRule: "additive" as const, occurredOn: "2026-06-09" };
    await db.insert(emissionEntries).values([
      { ...values, componentId: "recorded-zero", kind: "zero", confirmedForRemovalId: main.removalId },
      { ...values, componentId: "deleted", kind: "value", deletedAt: new Date() },
      { ...values, componentId: "other-day", kind: "value", occurredOn: "2026-06-10" },
      { ...values, componentId: "other-batch", kind: "value", creditBatchId: otherFacility.batchId },
    ]);
    const todos = async () => buildCreditBatchOpenItems({ facilityId: main.facilityId,
      creditBatchId: main.batchId, canManage: true, lateProductionRuns: await read() });
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
