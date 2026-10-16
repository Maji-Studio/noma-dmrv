import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, creditBatches, documents, emissionEntries,
  emissionEntryValues, removalTemplateObservations, storageObjectDeletions, users } from "@/db/schema";
import { createEmissionEntry, getEmissionEntry, markNothingToRecord, replaceEmissionEntry } from "@/data-access/emission-entries";
import { insertDocument, listDocumentsForEntity } from "@/data-access/documents";
import { cleanupLineageFixture, createLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

// DB-backed: written for a separately provisioned throwaway database. Do not run in offline verification.
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ requireEmissionsEntriesEnabled: vi.fn() }));
const userId = `replace-entry-${crypto.randomUUID()}`;
const ctx = makeTestOrgContext(userId);
const templateId = `replace-template-${crypto.randomUUID()}`;
const BASE_OBSERVED_AT = new Date("2026-01-01");
const CURRENT_OBSERVED_AT = new Date("2026-01-02");
let fixture: LineageFixture;
let baseline: typeof removalTemplateObservations.$inferSelect;
const submissionIds: string[] = [];
function values(componentId = "lab", unit = "kWh") {
  return (componentId === "meter" ? ["initial_readout", "final_readout"] : ["electricity_use"])
    .map(inputKey => ({ inputKey, quantityKind: "energy" as const, magnitude: "2", unit }));
}
beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, emailVerified: true });
  fixture = await createLineageFixture("none");
  [baseline] = await db.insert(removalTemplateObservations).values({
    organizationId: TEST_ORG_ID, provider: "isometric", externalProjectId: "project", externalTemplateId: templateId,
    semanticFingerprint: "baseline", fullFingerprint: "baseline", lastObservedAt: BASE_OBSERVED_AT,
    definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "Group", description: "",
      components: ["lab", "meter"].map(id => ({ id, displayName: id, description: null,
        blueprintKey: id === "meter" ? "metered_energy_based_ci_emissions" : "grid_electricity_use",
        inputs: values(id).map(value => ({ key: value.inputKey, type: "monitored" as const, quantityKind: "energy" as const })),
      })),
    }] },
    enrichment: { lab: { electricity_use: { unit: "kWh" } },
      meter: { initial_readout: { unit: "kWh" }, final_readout: { unit: "kWh" } } },
    lineSources: { lab: { scope: "operating", entryPolicy: "additive", origin: "reviewed" },
      meter: { scope: "operating", entryPolicy: "single", origin: "reviewed" } },
  }).returning();
  await db.update(creditBatches).set({ removalTemplateId: templateId })
    .where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, fixture.batchId)));
});
afterEach(async () => {
  // Discover committed replacements too, so a failing assertion cannot leak rows.
  const entries = await db.select({ id: emissionEntries.id }).from(emissionEntries)
    .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.creditBatchId, fixture.batchId)));
  const ids = entries.map(entry => entry.id);
  if (ids.length) {
    await db.delete(documents).where(and(eq(documents.organizationId, ctx.organizationId),
      eq(documents.entityType, "emission_entry"), inArray(documents.entityId, ids)));
    await db.delete(emissionEntryValues).where(inArray(emissionEntryValues.entryId, ids));
    await db.delete(emissionEntries).where(inArray(emissionEntries.id, ids));
  }
  if (submissionIds.length) {
    await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.id, submissionIds));
    submissionIds.length = 0;
  }
  await db.delete(removalTemplateObservations).where(and(eq(removalTemplateObservations.externalTemplateId, templateId),
    eq(removalTemplateObservations.fullFingerprint, "current")));
});
afterAll(async () => {
  if (fixture) await cleanupLineageFixture(fixture);
  await db.delete(removalTemplateObservations).where(eq(removalTemplateObservations.externalTemplateId, templateId));
  await db.delete(activityEvents).where(eq(activityEvents.actorUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
});
async function original(componentId = "lab") {
  return createEmissionEntry(ctx, { creditBatchId: fixture.batchId, componentId, values: values(componentId) });
}
async function changeTemplate() {
  const [current] = await db.insert(removalTemplateObservations).values({
    organizationId: ctx.organizationId, provider: baseline.provider, externalProjectId: baseline.externalProjectId,
    externalTemplateId: templateId, semanticFingerprint: "current", fullFingerprint: "current",
    definition: baseline.definition, lineSources: baseline.lineSources, lastObservedAt: CURRENT_OBSERVED_AT,
    enrichment: { lab: { electricity_use: { unit: "MJ" } },
      meter: { initial_readout: { unit: "MJ" }, final_readout: { unit: "MJ" } } },
  }).returning();
  return current;
}
function replacement(row: { id: string; version: number; componentId: string }) {
  return { id: row.id, expectedVersion: row.version, values: values(row.componentId, "MJ"), note: "Entered again" };
}
async function document(entryId: string, uploadStatus: "uploaded" | "pending" | "failed" = "uploaded") {
  return insertDocument(ctx, { entityType: "emission_entry", entityId: entryId, documentType: "pdf",
    fileName: "Evidence", storageProvider: "local-fs", storageBucket: "documents",
    storageKey: `replace-evidence/${crypto.randomUUID()}`, uploadStatus });
}
async function stored(id: string) {
  const [row] = await db.select().from(emissionEntries)
    .where(and(eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, id)));
  return row;
}
async function reserve(id: string) {
  const [submission] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId,
    provider: "isometric", localEntityType: "removal", localEntityId: fixture.removalId,
    submissionType: "removal", version: 1, status: "draft" }).returning();
  submissionIds.push(submission.id);
  await db.update(emissionEntries).set({ sendReservedBySubmissionId: submission.id }).where(eq(emissionEntries.id, id));
}

it("atomically replaces a stopped entry, moves active document owners and captures delete/create activity", async () => {
  const row = await original();
  const uploaded = await document(row.id);
  const pending = await document(row.id, "pending");
  const failed = await document(row.id, "failed");
  const before = await getEmissionEntry(ctx, row.id);
  const current = await changeTemplate();
  const after = await replaceEmissionEntry(ctx, replacement(before));
  expect(after).toMatchObject({ creditBatchId: before.creditBatchId, componentId: before.componentId,
    observationId: current.id, version: 1, contentRevision: 1, documentCount: 1, note: "Entered again" });
  expect(after.id).not.toBe(before.id);
  expect(after.values).toEqual([expect.objectContaining({ entryId: after.id, magnitude: "2", unit: "MJ" })]);
  expect(await stored(before.id)).toMatchObject({ deletedAt: expect.any(Date),
    version: before.version + 1, contentRevision: before.contentRevision + 1, observationId: baseline.id });
  expect(await db.select().from(emissionEntryValues).where(eq(emissionEntryValues.entryId, before.id))).toEqual(before.values);
  const moved = await listDocumentsForEntity(ctx, "emission_entry", after.id);
  expect(moved.map(file => file.id).sort()).toEqual([uploaded.id, pending.id].sort());
  for (const file of [uploaded, pending]) {
    expect(moved.find(candidate => candidate.id === file.id)).toMatchObject({ entityId: after.id,
      storageKey: file.storageKey, version: file.version + 1, uploadStatus: file.uploadStatus });
    expect(await db.select().from(storageObjectDeletions).where(eq(storageObjectDeletions.storageKey, file.storageKey!))).toEqual([]);
  }
  expect(await db.select().from(documents).where(eq(documents.id, failed.id))).toEqual([failed]);
  await expect(listDocumentsForEntity(ctx, "emission_entry", before.id)).rejects.toThrow("not found");
  const events = await db.select().from(activityEvents).where(inArray(activityEvents.entityId, [before.id, after.id]));
  expect(events.filter(event => event.entityId === before.id && event.action === "deleted")).toHaveLength(1);
  expect(events.filter(event => event.entityId === after.id && event.action === "created")).toHaveLength(1);
});

it("refuses an entry that still counts without changing it", async () => {
  const before = await original();
  await expect(replaceEmissionEntry(ctx, { ...replacement(before), values: values() })).rejects.toThrow("still counts");
  expect(await getEmissionEntry(ctx, before.id)).toEqual(before);
});
it("refuses a stale version and a foreign organization", async () => {
  const before = await original();
  await changeTemplate();
  await expect(replaceEmissionEntry(ctx, { ...replacement(before), expectedVersion: before.version + 1 }))
    .rejects.toMatchObject({ code: "stale_version" });
  await expect(replaceEmissionEntry({ ...ctx, organizationId: "foreign" }, replacement(before))).rejects.toThrow("not found");
  expect(await getEmissionEntry(ctx, before.id)).toEqual(before);
});
it.each(["reserved", "sent"] as const)("refuses a %s stopped entry", async state => {
  const row = await original();
  await changeTemplate();
  if (state === "reserved") await reserve(row.id);
  else await db.update(emissionEntries).set({ sentByRemovalId: fixture.removalId }).where(eq(emissionEntries.id, row.id));
  const before = await getEmissionEntry(ctx, row.id);
  await expect(replaceEmissionEntry(ctx, replacement(before))).rejects.toMatchObject({ code: "certification_locked" });
  expect(await getEmissionEntry(ctx, row.id)).toEqual(before);
});
it("replaces its own single line, defaults to batch start and refuses a second active value", async () => {
  const before = await original("meter");
  await changeTemplate();
  const after = await replaceEmissionEntry(ctx, { ...replacement(before), occurredOn: "2026-01-20" });
  const [batch] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batchId));
  expect(after).toMatchObject({ lineRule: "single", occurredOn: batch.startDate });
  await expect(createEmissionEntry(ctx, { creditBatchId: fixture.batchId, componentId: "meter", values: values("meter", "MJ") }))
    .rejects.toThrow("already has an entry");
});
it("refuses replacement when a changed single line already has another active value", async () => {
  const first = await original();
  const second = await original();
  const current = await changeTemplate();
  await db.update(removalTemplateObservations).set({
    definition: { ...current.definition, groups: current.definition.groups.map(group => ({ ...group,
      components: group.components.map(component => component.id !== "lab" ? component : {
        ...component, inputs: values("meter").map(value => ({ key: value.inputKey, type: "monitored" as const, quantityKind: "energy" as const })),
      }),
    })) },
    enrichment: { ...current.enrichment, lab: { initial_readout: { unit: "MJ" }, final_readout: { unit: "MJ" } } },
    lineSources: { ...current.lineSources, lab: { scope: "operating", entryPolicy: "single", origin: "reviewed" } },
  }).where(eq(removalTemplateObservations.id, current.id));
  await expect(replaceEmissionEntry(ctx, { ...replacement(first), values: values("meter", "MJ") })).rejects.toThrow("already has an entry");
  expect(await getEmissionEntry(ctx, first.id)).toEqual(first);
  expect(await getEmissionEntry(ctx, second.id)).toEqual(second);
});
it("rolls back the tombstone and activity when replacement validation fails", async () => {
  const row = await original();
  const file = await document(row.id);
  const before = await getEmissionEntry(ctx, row.id);
  await changeTemplate();
  await expect(replaceEmissionEntry(ctx, { ...replacement(before), values: values() })).rejects.toThrow("supported unit");
  expect(await getEmissionEntry(ctx, row.id)).toEqual(before);
  expect(await listDocumentsForEntity(ctx, "emission_entry", row.id)).toEqual([file]);
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.entityId, row.id), eq(activityEvents.action, "deleted")))).toEqual([]);
});
it("rolls back an inserted replacement when operator-zero tombstoning fails", async () => {
  const row = await original();
  const file = await document(row.id);
  const before = await getEmissionEntry(ctx, row.id);
  await changeTemplate();
  // Seed an operator zero beside a stopped value to exercise failure after insertion.
  const [zero] = await db.insert(emissionEntries).values({ organizationId: ctx.organizationId,
    creditBatchId: row.creditBatchId, componentId: row.componentId, removalTemplateId: templateId,
    observationId: baseline.id, inputShape: row.inputShape, lineRule: "additive", kind: "zero",
    occurredOn: row.occurredOn, createdBy: ctx.userId }).returning();
  await reserve(zero.id);
  await expect(replaceEmissionEntry(ctx, replacement(before))).rejects.toThrow("reserved or sent");
  expect(await getEmissionEntry(ctx, row.id)).toEqual(before);
  expect(await listDocumentsForEntity(ctx, "emission_entry", row.id)).toEqual([file]);
  const rows = await db.select().from(emissionEntries).where(eq(emissionEntries.creditBatchId, fixture.batchId));
  expect(rows.map(entry => entry.id).sort()).toEqual([row.id, zero.id].sort());
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.entityId, row.id), eq(activityEvents.action, "deleted")))).toEqual([]);
});
it("tombstones an operator zero when replacement succeeds", async () => {
  const confirmation = await markNothingToRecord(ctx, { facilityId: fixture.facilityId, creditBatchId: fixture.batchId, componentId: "lab" });
  // Preserve the zero as an old-template confirmation while constructing a stopped value.
  const [row] = await db.insert(emissionEntries).values({ organizationId: ctx.organizationId,
    creditBatchId: fixture.batchId, componentId: "lab", removalTemplateId: templateId,
    observationId: baseline.id, inputShape: baseline.definition.groups[0].components[0].inputs,
    lineRule: "additive", kind: "value", occurredOn: confirmation.occurredOn, createdBy: ctx.userId }).returning();
  await db.insert(emissionEntryValues).values({ organizationId: ctx.organizationId, entryId: row.id,
    inputKey: "electricity_use", magnitude: "1", unit: "kWh" });
  await changeTemplate();
  await replaceEmissionEntry(ctx, replacement(row));
  expect(await stored(confirmation.id)).toMatchObject({ deletedAt: expect.any(Date), version: confirmation.version + 1 });
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.entityId, confirmation.id), eq(activityEvents.action, "deleted")))).toHaveLength(1);
});
