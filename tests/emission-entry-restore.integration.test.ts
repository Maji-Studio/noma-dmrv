import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, creditBatches, documents, emissionEntries,
  emissionEntryValues, facilities, productionRuns, removalTemplateObservations, storageObjectDeletions, users } from "@/db/schema";
import { createEmissionEntry, deleteEmissionEntry, getEmissionEntry, markNothingToRecord, restoreEmissionEntry } from "@/data-access/emission-entries";
import { insertDocument, listDocumentsForEntity } from "@/data-access/documents";
import { cleanupLineageFixture, createLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

// DB-backed. Written for the supervisor to run; never part of the offline unit command.
const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({
  emissionsEntriesEnabled: () => gate.enabled,
  requireEmissionsEntriesEnabled: () => { if (!gate.enabled) throw new Error("Disabled"); },
}));
const userId = `restore-entry-${crypto.randomUUID()}`;
const ctx = makeTestOrgContext(userId);
const templateId = `restore-template-${crypto.randomUUID()}`;
let fixture: LineageFixture;
let observationId: string;
const entryIds: string[] = [];
const submissionIds: string[] = [];

beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, emailVerified: true });
  fixture = await createLineageFixture("none");
  const [observation] = await db.insert(removalTemplateObservations).values({
    organizationId: TEST_ORG_ID, provider: "isometric", externalProjectId: "project", externalTemplateId: templateId,
    semanticFingerprint: "restore", fullFingerprint: "restore",
    definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "Group", description: "",
      components: ["lab", "site", "meter"].map(id => ({ id, displayName: id, description: null,
        blueprintKey: id === "meter" ? "metered_energy_based_ci_emissions" : "grid_electricity_use",
        inputs: (id === "meter" ? ["initial_readout", "final_readout"] : ["electricity_use"])
          .map(key => ({ key, type: "monitored" as const, quantityKind: "energy" as const })),
      })),
    }] },
    enrichment: { lab: { electricity_use: { unit: "kWh" } }, site: { electricity_use: { unit: "kWh" } },
      meter: { initial_readout: { unit: "kWh" }, final_readout: { unit: "kWh" } } },
    lineSources: {
      lab: { scope: "operating", entryPolicy: "additive", origin: "reviewed" },
      site: { scope: "operating", entryPolicy: "additive", origin: "reviewed", automaticSource: "run-electricity" },
      meter: { scope: "operating", entryPolicy: "single", origin: "reviewed" },
    },
  }).returning();
  observationId = observation.id;
  await db.update(creditBatches).set({ removalTemplateId: templateId }).where(eq(creditBatches.id, fixture.batchId));
});
afterEach(async () => {
  gate.enabled = true;
  if (entryIds.length) {
    await db.delete(documents).where(and(eq(documents.organizationId, ctx.organizationId), inArray(documents.entityId, entryIds)));
    await db.delete(emissionEntryValues).where(inArray(emissionEntryValues.entryId, entryIds));
    await db.delete(emissionEntries).where(inArray(emissionEntries.id, entryIds));
    entryIds.length = 0;
  }
  if (submissionIds.length) {
    await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.id, submissionIds));
    submissionIds.length = 0;
  }
});
afterAll(async () => {
  if (fixture) await cleanupLineageFixture(fixture);
  await db.delete(removalTemplateObservations).where(eq(removalTemplateObservations.externalTemplateId, templateId));
  await db.delete(activityEvents).where(eq(activityEvents.actorUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
});
async function value(componentId = "lab") {
  const row = await createEmissionEntry(ctx, { creditBatchId: fixture.batchId, componentId,
    values: (componentId === "meter" ? ["initial_readout", "final_readout"] : ["electricity_use"])
      .map(inputKey => ({ inputKey, quantityKind: "energy" as const, magnitude: "1", unit: "kWh" })),
  });
  entryIds.push(row.id);
  return row;
}
async function zero(componentId = "lab") {
  const row = await markNothingToRecord(ctx, { facilityId: fixture.facilityId, creditBatchId: fixture.batchId, componentId });
  entryIds.push(row.id);
  return row;
}
async function deleted(componentId = "lab") {
  const row = await value(componentId);
  await deleteEmissionEntry(ctx, row.id, row.version);
  return { id: row.id, expectedVersion: row.version + 1 };
}

it("restores the original values and files, bumps both versions, and captures before/after activity", async () => {
  const row = await value();
  const file = await insertDocument(ctx, { entityType: "emission_entry", entityId: row.id,
    documentType: "pdf", fileName: "Evidence", storageProvider: "local-fs", storageBucket: "documents",
    storageKey: `restore-evidence/${crypto.randomUUID()}`, uploadStatus: "uploaded" });
  const before = await getEmissionEntry(ctx, row.id);
  await deleteEmissionEntry(ctx, row.id, before.version);
  await expect(listDocumentsForEntity(ctx, "emission_entry", row.id)).rejects.toThrow("not found");
  expect(await db.select().from(documents).where(eq(documents.id, file.id))).toHaveLength(1);
  const restored = await restoreEmissionEntry(ctx, { id: row.id, expectedVersion: before.version + 1 });
  expect(restored).toMatchObject({ deletedAt: null, version: before.version + 2,
    contentRevision: before.contentRevision + 2, values: before.values, documentCount: before.documentCount });
  expect((await listDocumentsForEntity(ctx, "emission_entry", row.id)).map(document => document.id)).toContain(file.id);
  const events = await db.select().from(activityEvents).where(and(eq(activityEvents.entityId, row.id), eq(activityEvents.action, "updated")));
  expect(events).toContainEqual(expect.objectContaining({ changedFields: ["deletedAt"],
    changes: { deletedAt: { from: expect.any(String), to: null } } }));
  expect(await db.select().from(storageObjectDeletions).where(eq(storageObjectDeletions.storageKey, file.storageKey!))).toEqual([]);
});

it("refuses a stale version, foreign org, disabled gate, duplicate restore and unknown id", async () => {
  const input = await deleted();
  await expect(restoreEmissionEntry(ctx, { ...input, expectedVersion: 1 })).rejects.toMatchObject({ code: "stale_version" });
  await expect(restoreEmissionEntry({ ...ctx, organizationId: "foreign" }, input)).rejects.toThrow("not found");
  await expect(restoreEmissionEntry(ctx, { ...input, id: crypto.randomUUID() })).rejects.toThrow("not found");
  gate.enabled = false;
  await expect(restoreEmissionEntry(ctx, input)).rejects.toThrow("Disabled");
  gate.enabled = true;
  const row = await restoreEmissionEntry(ctx, input);
  await expect(restoreEmissionEntry(ctx, { id: row.id, expectedVersion: row.version })).rejects.toThrow("already active");
});

it("serializes two restores so a single line cannot acquire two values", async () => {
  const first = await deleted("meter");
  const second = await deleted("meter");
  const results = await Promise.allSettled([restoreEmissionEntry(ctx, first), restoreEmissionEntry(ctx, second)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { message: "This line already has an entry. Edit that entry instead." } });
});

it("restoring a value tombstones an operator zero and records its deletion", async () => {
  const input = await deleted();
  const confirmation = await zero();
  await restoreEmissionEntry(ctx, input);
  const [stored] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, confirmation.id));
  expect(stored).toMatchObject({ deletedAt: expect.any(Date), version: confirmation.version + 1, contentRevision: confirmation.contentRevision + 1 });
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.entityId, confirmation.id), eq(activityEvents.action, "deleted"))))
    .toHaveLength(1);
});

it("restores an operator zero only while no values or other operator zero exist", async () => {
  const row = await zero();
  await deleteEmissionEntry(ctx, row.id, row.version);
  const input = { id: row.id, expectedVersion: row.version + 1 };
  const restored = await restoreEmissionEntry(ctx, input);
  await deleteEmissionEntry(ctx, row.id, restored.version);
  input.expectedVersion = restored.version + 1;
  const other = await zero();
  await expect(restoreEmissionEntry(ctx, input)).rejects.toThrow("already marked");
  await deleteEmissionEntry(ctx, other.id, other.version);
  await value();
  await expect(restoreEmissionEntry(ctx, input)).rejects.toThrow("This line has entries.");
});

it("rolls back value restoration when its active operator zero is reserved", async () => {
  const input = await deleted();
  const confirmation = await zero();
  const [submission] = await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID,
    provider: "isometric", localEntityType: "removal", localEntityId: fixture.removalId,
    submissionType: "removal", version: 1, status: "draft" }).returning();
  submissionIds.push(submission.id);
  await db.update(emissionEntries).set({ sendReservedBySubmissionId: submission.id }).where(eq(emissionEntries.id, confirmation.id));
  await expect(restoreEmissionEntry(ctx, input)).rejects.toThrow("reserved or sent");
  const rows = await db.select().from(emissionEntries).where(inArray(emissionEntries.id, [input.id, confirmation.id]));
  expect(rows.find(row => row.id === input.id)).toMatchObject({ deletedAt: expect.any(Date), version: input.expectedVersion });
  expect(rows.find(row => row.id === confirmation.id)).toMatchObject({ deletedAt: null, version: confirmation.version });
});

it("refuses a restored zero after automatic records become positive", async () => {
  await db.update(productionRuns).set({ electricityKwh: 0 }).where(eq(productionRuns.id, fixture.productionRunId));
  const row = await zero("site");
  await deleteEmissionEntry(ctx, row.id, row.version);
  await db.update(productionRuns).set({ electricityKwh: 3 }).where(eq(productionRuns.id, fixture.productionRunId));
  await expect(restoreEmissionEntry(ctx, { id: row.id, expectedVersion: row.version + 1 })).rejects.toThrow("records from production runs");
});

it.each(["reserved", "sent", "owned-zero"] as const)("refuses a deleted entry that is %s without changing its tombstone", async state => {
  const input = await deleted();
  if (state === "reserved") {
    const [submission] = await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID,
      provider: "isometric", localEntityType: "removal", localEntityId: fixture.removalId,
      submissionType: "removal", version: 1, status: "draft" }).returning();
    submissionIds.push(submission.id);
    await db.update(emissionEntries).set({ sendReservedBySubmissionId: submission.id }).where(eq(emissionEntries.id, input.id));
  } else await db.update(emissionEntries).set(state === "sent" ? { sentByRemovalId: fixture.removalId }
    : { kind: "zero", confirmedForRemovalId: fixture.removalId }).where(eq(emissionEntries.id, input.id));
  await expect(restoreEmissionEntry(ctx, input)).rejects.toThrow(state === "owned-zero" ? "through their Removal" : "reserved or sent");
  const [row] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, input.id));
  expect(row).toMatchObject({ deletedAt: expect.any(Date), version: input.expectedVersion });
});

it.each(["facility", "batch", "template"] as const)("refuses restore after the %s stops accepting entries", async state => {
  const input = await deleted();
  try {
    if (state === "facility") await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, fixture.facilityId));
    if (state === "batch") await db.update(creditBatches).set({ archivedAt: new Date() }).where(eq(creditBatches.id, fixture.batchId));
    if (state === "template") await db.update(creditBatches).set({ removalTemplateId: "different-template" }).where(eq(creditBatches.id, fixture.batchId));
    await expect(restoreEmissionEntry(ctx, input)).rejects.toThrow();
  } finally {
    await db.update(facilities).set({ archivedAt: null }).where(eq(facilities.id, fixture.facilityId));
    await db.update(creditBatches).set({ archivedAt: null, removalTemplateId: templateId }).where(eq(creditBatches.id, fixture.batchId));
  }
});

it("refuses a line whose reviewed contract now forbids entries", async () => {
  const input = await deleted();
  const [original] = await db.select().from(removalTemplateObservations).where(eq(removalTemplateObservations.id, observationId));
  try {
    await db.update(removalTemplateObservations).set({ lineSources: { ...original.lineSources,
      lab: { scope: "forbidden", entryPolicy: "none", origin: "reviewed" } } }).where(eq(removalTemplateObservations.id, observationId));
    await expect(restoreEmissionEntry(ctx, input)).rejects.toThrow("no longer matches");
  } finally {
    await db.update(removalTemplateObservations).set({ lineSources: original.lineSources }).where(eq(removalTemplateObservations.id, observationId));
  }
});
