import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents, certificationSubmissions, certifierRemovals, creditBatches,
  creditBatchProductionRuns, emissionEntries, emissionEntryValues, facilities,
  feedstockTypes, productionProcesses, removalTemplateObservations, users,
} from "@/db/schema";
import { createCreditBatch, updateCreditBatch } from "@/data-access/credit-batches";
import { createEmissionEntry, deleteEmissionEntry, getEmissionEntry } from "@/data-access/emission-entries";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import { ActionConflictError } from "@/lib/errors";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import { TEST_SITE_POSITION, TEST_ORG_ID, ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

// Real DB and writers. Only the feature switch is controlled by the suite.
const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, get EMISSIONS_ENTRIES_ENABLED() { return flag.enabled; } } };
});

const tag = crypto.randomUUID();
const userId = `batch-entry-dates-${tag}`;
const ctx = makeTestOrgContext(userId);
const templateId = `batch-entry-dates-template-${tag}`;
let batch: Awaited<ReturnType<typeof createCreditBatch>>;
let facilityId: string;
let feedstockTypeId: string;
let observationId: string;
const removalIds: string[] = [];
const submissionIds: string[] = [];

function observation(): EntryObservation {
  return {
    externalTemplateId: templateId,
    definition: { groups: [{
      id: "operating", key: "operating", displayName: "Operating", description: "",
      components: [
        { id: "lab", displayName: "Lab electricity", description: "", blueprintKey: "grid_electricity_use",
          inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] },
        { id: "meter", displayName: "Meter readings", description: "", blueprintKey: "metered_energy_based_ci_emissions",
          inputs: ["initial_readout", "final_readout"].map((key) => ({ key, type: "monitored", quantityKind: "energy" })) },
      ],
    }] },
    enrichment: {
      lab: { electricity_use: { unit: "kWh" } },
      meter: { initial_readout: { unit: "kWh" }, final_readout: { unit: "kWh" } },
    },
    lineSources: {
      lab: { scope: "operating", entryPolicy: "additive", origin: "reviewed" },
      meter: { scope: "operating", entryPolicy: "single", origin: "reviewed" },
    },
  };
}

function createEntry(occurredOn = "2026-06-13", componentId = "lab") {
  return createEmissionEntry(ctx, {
    creditBatchId: batch.id, componentId, occurredOn,
    values: (componentId === "meter" ? ["initial_readout", "final_readout"] : ["electricity_use"])
      .map((inputKey, index) => ({ inputKey, quantityKind: "energy" as const, magnitude: String(index + 1), unit: "kWh" })),
  });
}

async function stored() {
  const [row] = await db.select().from(creditBatches).where(eq(creditBatches.id, batch.id));
  const entries = await db.select().from(emissionEntries)
    .where(eq(emissionEntries.creditBatchId, batch.id)).orderBy(emissionEntries.id);
  const values = entries.length ? await db.select().from(emissionEntryValues)
    .where(inArray(emissionEntryValues.entryId, entries.map((entry) => entry.id))).orderBy(emissionEntryValues.id) : [];
  const events = await db.select().from(activityEvents)
    .where(eq(activityEvents.creditBatchId, batch.id)).orderBy(activityEvents.sequence);
  return { row, entries, values, events };
}

beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({ id: userId, name: "Batch dates fixture", email: `${userId}@example.test`, emailVerified: true });
  const [saved] = await db.insert(removalTemplateObservations).values({
    organizationId: TEST_ORG_ID, provider: "isometric", externalProjectId: "project",
    ...observation(), semanticFingerprint: tag, fullFingerprint: tag,
  }).returning();
  observationId = saved.id;
});

beforeEach(async () => {
  flag.enabled = true;
  const caseTag = crypto.randomUUID();
  const [facility] = await db.insert(facilities).values({
    ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID, timezone: "UTC",
    name: `Batch dates ${caseTag}`, code: `FAC-DATES-${caseTag}`,
  }).returning();
  facilityId = facility.id;
  const [feedstockType] = await db.insert(feedstockTypes).values({
    organizationId: TEST_ORG_ID, usage: "pyrolysis", category: "forestry",
    name: `Batch dates ${caseTag}`, code: `FT-DATES-${caseTag}`,
  }).returning();
  feedstockTypeId = feedstockType.id;
  batch = await createCreditBatch(ctx, {
    code: `CB-DATES-${caseTag}`, facilityId, feedstockTypeId, productionRunIds: [],
    startDate: new Date("2026-06-01"), endDate: new Date("2026-06-30"),
  });
  await db.update(creditBatches).set({ removalTemplateId: templateId }).where(eq(creditBatches.id, batch.id));
});

afterEach(async () => {
  flag.enabled = true;
  const entries = await db.select({ id: emissionEntries.id }).from(emissionEntries)
    .where(eq(emissionEntries.creditBatchId, batch.id));
  if (entries.length) await db.delete(emissionEntryValues).where(inArray(emissionEntryValues.entryId, entries.map((entry) => entry.id)));
  await db.delete(emissionEntries).where(eq(emissionEntries.creditBatchId, batch.id));
  if (submissionIds.length) await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.id, submissionIds.splice(0)));
  if (removalIds.length) await db.delete(certifierRemovals).where(inArray(certifierRemovals.id, removalIds.splice(0)));
  await db.delete(activityEvents).where(eq(activityEvents.creditBatchId, batch.id));
  await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, batch.id));
  await db.delete(creditBatches).where(eq(creditBatches.id, batch.id));
  await db.delete(productionProcesses).where(eq(productionProcesses.facilityId, facilityId));
  await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockTypeId));
  await db.delete(facilities).where(eq(facilities.id, facilityId));
});

afterAll(async () => {
  await db.delete(removalTemplateObservations).where(eq(removalTemplateObservations.id, observationId));
  await db.delete(users).where(eq(users.id, userId));
});

it.each([
  { startDate: new Date("2026-06-14") },
  { endDate: new Date("2026-06-12") },
])("refuses an excluded dated entry and leaves all rows and activity unchanged: %o", async (patch) => {
  await createEntry();
  await createEntry(undefined, "meter");
  const before = await stored();
  await expect(updateCreditBatch(ctx, batch.id, {
    ...patch, expectedVersion: batch.version, siteManagementNotes: "Must roll back",
  })).rejects.toMatchObject({
    name: "ActionConflictError",
    message: expect.stringContaining("Lab electricity on Jun 13, 2026"),
    conflict: { entity: "credit_batch", id: batch.id, code: batch.code },
  });
  expect(await stored()).toEqual(before);
});

it("allows a narrower window when dated entries stay inside, including both boundary days", async () => {
  const first = await createEntry("2026-06-10");
  const last = await createEntry("2026-06-20");
  const saved = await updateCreditBatch(ctx, batch.id, {
    expectedVersion: batch.version, startDate: new Date(first.occurredOn), endDate: new Date(last.occurredOn),
  });
  expect(saved).toMatchObject({ startDate: first.occurredOn, endDate: last.occurredOn, version: batch.version + 1 });
  expect(await getEmissionEntry(ctx, first.id)).toMatchObject({ occurredOn: first.occurredOn, version: first.version });
});

it("re-dates a whole-batch entry with persisted activity and content revision", async () => {
  const entry = await createEntry(undefined, "meter");
  expect(entry.occurredOn).toBe(batch.startDate);
  await updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version, startDate: new Date("2026-06-15") });
  const saved = await getEmissionEntry(ctx, entry.id);
  expect(saved).toMatchObject({ occurredOn: "2026-06-15", version: entry.version + 1, contentRevision: entry.contentRevision + 1 });
  expect(saved.values).toEqual(entry.values);
  const events = await db.select().from(activityEvents).where(and(
    eq(activityEvents.entityId, entry.id), eq(activityEvents.action, "updated"),
  ));
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    entityType: "emission_entry", creditBatchId: batch.id, source: "form", actorUserId: userId,
    changedFields: ["occurredOn"], changes: { occurredOn: { from: entry.occurredOn, to: saved.occurredOn } },
  });
});

it("allows an earlier start and re-dates whole-batch entries without changing dated entries", async () => {
  const dated = await createEntry();
  const single = await createEntry(undefined, "meter");
  const saved = await updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version, startDate: new Date("2026-05-31") });
  expect(saved.startDate).toBe("2026-05-31");
  expect(await getEmissionEntry(ctx, dated.id)).toMatchObject({ occurredOn: dated.occurredOn, version: dated.version });
  expect(await getEmissionEntry(ctx, single.id)).toMatchObject({ occurredOn: saved.startDate, version: single.version + 1 });
});

it("allows a later end without re-dating or revising any entry", async () => {
  await createEntry();
  await createEntry(undefined, "meter");
  const before = await stored();
  const saved = await updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version, endDate: new Date("2026-07-01") });
  expect(saved.endDate).toBe("2026-07-01");
  expect((await stored()).entries).toEqual(before.entries);
});

it("ignores tombstoned entries and still guards live entries when the feature is off", async () => {
  const deleted = await createEntry("2026-06-05");
  await deleteEmissionEntry(ctx, deleted.id, deleted.version);
  await createEntry("2026-06-20");
  flag.enabled = false;
  const saved = await updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version, startDate: new Date("2026-06-10") });
  const before = await stored();
  await expect(updateCreditBatch(ctx, batch.id, {
    expectedVersion: saved.version, startDate: new Date("2026-06-21"),
  })).rejects.toBeInstanceOf(ActionConflictError);
  expect(await stored()).toEqual(before);
  expect(before.entries.find((entry) => entry.id === deleted.id)).toMatchObject({ occurredOn: deleted.occurredOn });
});

it.each(["reserved", "sent"] as const)("keeps the %s entry guard on whole-batch re-dating", async (kind) => {
  const entry = await createEntry(undefined, "meter");
  const [removal] = await insertRemovalFixture(db, { organizationId: TEST_ORG_ID, facilityId });
  removalIds.push(removal.id);
  if (kind === "sent") {
    await db.update(emissionEntries).set({ sentByRemovalId: removal.id }).where(eq(emissionEntries.id, entry.id));
  } else {
    const [submission] = await db.insert(certificationSubmissions).values({
      organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
      localEntityType: "removal", localEntityId: removal.id, version: 1, status: "draft",
    }).returning();
    submissionIds.push(submission.id);
    await db.update(emissionEntries).set({ sendReservedBySubmissionId: submission.id }).where(eq(emissionEntries.id, entry.id));
  }
  const before = await stored();
  await expect(updateCreditBatch(ctx, batch.id, {
    expectedVersion: batch.version, startDate: new Date("2026-06-15"),
  })).rejects.toMatchObject({ code: "certification_locked" });
  expect(await stored()).toEqual(before);
});
