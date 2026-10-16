import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, creditBatches, certifierRemovals, facilities, documents, emissionEntries, emissionEntryValues, organizations, removalTemplateObservations, storageObjectDeletions, users } from "@/db/schema";
import { createEmissionEntry, updateEmissionEntry, deleteEmissionEntry, confirmEmissionEntry, getEmissionEntry, listEmissionEntries } from "@/data-access/emission-entries";
import { insertDocument } from "@/data-access/documents";
import { requestDocumentUploadInTransaction, confirmDocumentUploadInTransaction, uploadFactsFor } from "@/data-access/document-writes";
import { deleteDocumentInTransaction } from "@/data-access/document-mutations";
import { createTransportLeg } from "@/data-access/transport-legs";
import { loadBatchEmissionLines } from "@/lib/read-models/batch-emission-lines";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/config/env", async importOriginal => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, get EMISSIONS_ENTRIES_ENABLED() { return flag.enabled; } } };
});
const userId = `emission-entry-user-${crypto.randomUUID()}`;
const ctx = makeTestOrgContext(userId);
const otherOrg = `emission-entry-org-${crypto.randomUUID()}`;
const templateId = `entry-template-${crypto.randomUUID()}`;
let lineage: LineageFixture;
let observationId: string;
const entryIds: string[] = [];
const submissionIds: string[] = [];
const storageKeys: string[] = [];
const extraRemovalIds: string[] = [];
function definition(): EntryObservation {
  const inputs = [{ key: "electricity_use", type: "monitored" as const, quantityKind: "energy" as const }];
  return { externalTemplateId: templateId, definition: { groups: [{ id: "group", key: "pyrolysis", displayName: "Group", description: "", components: [
    { id: "energy", displayName: "Lab electricity", description: "Recorded electricity", blueprintKey: "grid_electricity_use", inputs },
    { id: "meter", displayName: "Meter", description: null, blueprintKey: "metered_energy_based_ci_emissions", inputs: ["initial_readout", "final_readout"].map(key => ({ key, type: "monitored", quantityKind: "energy" })) },
  ] }] }, enrichment: { energy: { electricity_use: { unit: "kWh" } }, meter: { initial_readout: { unit: "kWh" }, final_readout: { unit: "kWh" } } }, lineSources: { energy: { scope: "operating", entryPolicy: "additive", origin: "reviewed" }, meter: { scope: "operating", entryPolicy: "single", origin: "reviewed" } } };
}
async function create(componentId = "energy") {
  const values = componentId === "meter" ? ["initial_readout", "final_readout"].map(inputKey => ({ inputKey, quantityKind: "energy" as const, magnitude: "1", unit: "kWh" })) : [{ inputKey: "electricity_use", quantityKind: "energy" as const, magnitude: "0.1", unit: "kWh" }];
  const entry = await createEmissionEntry(ctx, { creditBatchId: lineage.batchId, componentId, occurredOn: "2026-06-13", values });
  entryIds.push(entry.id); return entry;
}
async function claim(entryId: string, kind: "reserved" | "sent") {
  if (kind === "sent") { await db.update(emissionEntries).set({ sentByRemovalId: lineage.removalId }).where(eq(emissionEntries.id, entryId)); return; }
  const [submission] = await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: lineage.removalId, version: submissionIds.length + 1, status: "draft" }).returning();
  submissionIds.push(submission.id);
  await db.update(emissionEntries).set({ sendReservedBySubmissionId: submission.id }).where(eq(emissionEntries.id, entryId));
}
beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({ id: userId, name: "Entry fixture", email: `${userId}@example.test`, emailVerified: true });
  await db.insert(organizations).values({ id: otherOrg, name: "Entry foreign fixture", slug: otherOrg });
  lineage = await createLineageFixture("none");
  const source = definition();
  const [observation] = await db.insert(removalTemplateObservations).values({ organizationId: TEST_ORG_ID, provider: "isometric", externalProjectId: "project", ...source, semanticFingerprint: "initial", fullFingerprint: "initial" }).returning();
  observationId = observation.id;
  await db.update(creditBatches).set({ removalTemplateId: templateId }).where(eq(creditBatches.id, lineage.batchId));
});
afterAll(async () => {
  if (entryIds.length) {
    await db.delete(documents).where(and(eq(documents.organizationId, TEST_ORG_ID), inArray(documents.entityId, entryIds)));
    await db.delete(emissionEntryValues).where(inArray(emissionEntryValues.entryId, entryIds));
    await db.delete(emissionEntries).where(inArray(emissionEntries.id, entryIds));
  }
  if (storageKeys.length) await db.delete(storageObjectDeletions).where(and(eq(storageObjectDeletions.organizationId, TEST_ORG_ID), inArray(storageObjectDeletions.storageKey, storageKeys)));
  if (submissionIds.length) await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.id, submissionIds));
  if (extraRemovalIds.length) await db.delete(certifierRemovals).where(inArray(certifierRemovals.id, extraRemovalIds));
  if (lineage) await cleanupLineageFixture(lineage);
  await db.delete(removalTemplateObservations).where(eq(removalTemplateObservations.externalTemplateId, templateId));
  await db.delete(activityEvents).where(eq(activityEvents.actorUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(organizations).where(eq(organizations.id, otherOrg));
});
it("creates, updates, conflicts and tombstones, with value-free batch activity", async () => {
  const entry = await create();
  expect(entry).toMatchObject({ version: 1, contentRevision: 1 });
  const note = await updateEmissionEntry(ctx, { id: entry.id, expectedVersion: 1, note: "Private fixture note" });
  expect(note).toMatchObject({ version: 2, contentRevision: 1 });
  await expect(updateEmissionEntry(ctx, { id: entry.id, expectedVersion: 1, note: "stale" })).rejects.toMatchObject({ code: "stale_version" });
  const updated = await updateEmissionEntry(ctx, { id: entry.id, expectedVersion: 2, values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "0.200000000000000001", unit: "kWh" }] });
  expect(updated).toMatchObject({ version: 3, contentRevision: 2 });
  expect(updated.values[0].magnitude).toBe("0.200000000000000001");
  await expect(deleteEmissionEntry(ctx, entry.id, 2)).rejects.toMatchObject({ code: "stale_version" });
  await deleteEmissionEntry(ctx, entry.id, 3);
  const [stored] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, entry.id));
  expect(stored.deletedAt).not.toBeNull();
  const events = await db.select().from(activityEvents).where(and(eq(activityEvents.entityType, "emission_entry"), eq(activityEvents.entityId, entry.id)));
  expect(events.map(event => event.action).sort()).toEqual(["created", "deleted", "updated", "updated"]);
  expect(events.every(event => event.creditBatchId === lineage.batchId)).toBe(true);
  expect(JSON.stringify(events)).not.toContain("Private fixture note");
  expect(JSON.stringify(events)).not.toContain("0.200000000000000001");
});
it("enforces the single index even for raw inserts", async () => {
  const entry = await create("meter");
  await expect(create("meter")).rejects.toThrow("already has");
  const [row] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, entry.id));
  await expect(db.insert(emissionEntries).values({ ...row, id: crypto.randomUUID() })).rejects.toThrow();
  await deleteEmissionEntry(ctx, entry.id, entry.version);
});
it("refuses cross-org composite references and scoped reads", async () => {
  const entry = await create();
  await expect(db.insert(emissionEntryValues).values({ organizationId: otherOrg, entryId: entry.id, inputKey: "foreign", magnitude: "1", unit: "kWh" })).rejects.toThrow();
  const [row] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, entry.id));
  await expect(db.insert(emissionEntries).values({ ...row, id: crypto.randomUUID(), organizationId: otherOrg })).rejects.toThrow();
  await expect(getEmissionEntry({ ...ctx, organizationId: otherOrg }, entry.id)).rejects.toThrow("not found");
});
it.each(["reserved", "sent"] as const)("refuses edits, deletion, confirmation and evidence while %s", async kind => {
  const entry = await create(); await claim(entry.id, kind);
  await expect(updateEmissionEntry(ctx, { id: entry.id, expectedVersion: 1, note: "blocked" })).rejects.toThrow("reserved or sent");
  await expect(deleteEmissionEntry(ctx, entry.id, 1)).rejects.toThrow("reserved or sent");
  await expect(confirmEmissionEntry(ctx, entry.id, 1)).rejects.toThrow("reserved or sent");
  await expect(insertDocument(ctx, { entityType: "emission_entry", entityId: entry.id, documentType: "pdf", fileUrl: "https://example.test/evidence", fileName: "Evidence" })).rejects.toThrow("reserved or sent");
});
it("attaches and retires evidence with content revisions, without the batch lineage guard", async () => {
  const entry = await create();
  const document = await insertDocument(ctx, { entityType: "emission_entry", entityId: entry.id, documentType: "pdf", fileUrl: "https://example.test/evidence", fileName: "Evidence" });
  expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({ version: 2, contentRevision: 2, documentCount: 1 });
  await db.transaction(tx => deleteDocumentInTransaction(ctx, tx, { documentId: document.id, expectedVersion: document.version }));
  expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({ version: 3, contentRevision: 3, documentCount: 0 });
  const second = await insertDocument(ctx, { entityType: "emission_entry", entityId: entry.id, documentType: "pdf", fileUrl: "https://example.test/evidence", fileName: "Evidence" });
  await claim(entry.id, "reserved");
  await expect(db.transaction(tx => deleteDocumentInTransaction(ctx, tx, { documentId: second.id, expectedVersion: second.version }))).rejects.toThrow("reserved or sent");
});
it("tombstones unsubmitted draft zeros on value creation", async () => {
  const [zero] = await db.insert(emissionEntries).values({ organizationId: TEST_ORG_ID, creditBatchId: lineage.batchId, removalTemplateId: templateId, componentId: "energy", inputShape: [], observationId, kind: "zero", lineRule: "additive", confirmedForRemovalId: lineage.removalId, occurredOn: "2026-06-13" }).returning();
  entryIds.push(zero.id);
  await expect(db.insert(emissionEntries).values({ ...zero, id: crypto.randomUUID() })).rejects.toThrow();
  const [otherDraft] = await db.insert(certifierRemovals).values({ organizationId: TEST_ORG_ID, facilityId: lineage.facilityId }).returning();
  extraRemovalIds.push(otherDraft.id);
  const [otherZero] = await db.insert(emissionEntries).values({ ...zero, id: crypto.randomUUID(), confirmedForRemovalId: otherDraft.id }).returning();
  entryIds.push(otherZero.id);
  await create();
  const [otherSaved] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, otherZero.id));
  expect(otherSaved.deletedAt).not.toBeNull();
  const [saved] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, zero.id));
  expect(saved.deletedAt).not.toBeNull();
});
it("loads real entries and hides them with the flag off", async () => {
  const entry = await create();
  const lines = await loadBatchEmissionLines(ctx, lineage.facilityId, lineage.batchId);
  expect(lines.find(line => line.componentId === "energy")?.entries.some(candidate => candidate.id === entry.id && candidate.counts)).toBe(true);
  await expect(loadBatchEmissionLines(ctx, crypto.randomUUID(), lineage.batchId)).rejects.toThrow();
  flag.enabled = false;
  try { expect(await listEmissionEntries(ctx, lineage.batchId)).toEqual([]); await expect(create()).rejects.toThrow("not available"); }
  finally { flag.enabled = true; }
});
it("refuses sample legs with the flag on before touching the sample", async () => {
  await expect(createTransportLeg(ctx, { entityType: "sample", entityId: lineage.sampleId, distanceKm: 1, loadMassKg: 1, transportMethodType: "road", calculationMethodType: "distance_based" })).rejects.toThrow("sample shipping");
});

it("confirms a compatible change with a version check and field-only audit", async () => {
  const entry = await create();
  const source = definition(); source.enrichment.energy.electricity_use = { unit: "Wh" };
  const [next] = await db.insert(removalTemplateObservations).values({ organizationId: TEST_ORG_ID, provider: "isometric", externalProjectId: "project", ...source,
    semanticFingerprint: "changed", fullFingerprint: "changed", lastObservedAt: new Date(Date.now() + 1000) }).returning();
  await expect(confirmEmissionEntry(ctx, entry.id, 99)).rejects.toMatchObject({ code: "stale_version" });
  expect(await confirmEmissionEntry(ctx, entry.id, 1)).toMatchObject({ observationId: next.id, version: 2, contentRevision: 2 });
  const events = await db.select().from(activityEvents).where(and(eq(activityEvents.entityType, "emission_entry"), eq(activityEvents.entityId, entry.id), eq(activityEvents.action, "updated")));
  expect(events).toHaveLength(1); expect(events[0].changedFields).toEqual(["observationId"]);
});

it("confirms uploaded evidence inside the entry revision transaction", async () => {
  const entry = await create();
  const pending = await db.transaction(tx => requestDocumentUploadInTransaction(ctx, tx, {
    entityType: "emission_entry", entityId: entry.id, documentType: "pdf", fileName: "entry.pdf", contentType: "application/pdf", sizeBytes: 10,
    storageProvider: "s3-compatible", storageBucket: "fixture-bucket",
  }));
  storageKeys.push(pending.uploadStorageKey!, `confirmed/${pending.id}`);
  expect((await getEmissionEntry(ctx, entry.id)).documentCount).toBe(0);
  const result = await db.transaction(tx => confirmDocumentUploadInTransaction(ctx, tx, {
    ...uploadFactsFor(pending), finalKey: `confirmed/${pending.id}`, inspectedSha256: "a".repeat(64), inspectedSizeBytes: 10, inspectedContentType: "application/pdf",
  }));
  expect(result.kind).toBe("uploaded");
  expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({ contentRevision: 2, version: 2, documentCount: 1 });
});
it("retains sample-leg creation when the flag is off", async () => {
  flag.enabled = false;
  try {
    const leg = await createTransportLeg(ctx, { entityType: "sample", entityId: lineage.sampleId, distanceKm: 1, loadMassKg: 1, transportMethodType: "road", calculationMethodType: "distance_based" });
    expect(leg.entityType).toBe("sample");
  } finally { flag.enabled = true; }
});

it("enforces organization consistency independently for observation and claim references", async () => {
  const entry = await create();
  const [facility] = await db.insert(facilities).values({ organizationId: otherOrg, code: "FAC-FOREIGN-ENTRY", name: "Foreign entry facility", country: "Tanzania", gpsLatitude: -8.3, gpsLongitude: 35.3, timezone: "UTC" }).returning();
  const [removal] = await db.insert(certifierRemovals).values({ organizationId: otherOrg, facilityId: facility.id }).returning();
  const [submission] = await db.insert(certificationSubmissions).values({ organizationId: otherOrg, provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: removal.id }).returning();
  const [foreignObservation] = await db.insert(removalTemplateObservations).values({ organizationId: otherOrg, provider: "isometric", externalProjectId: "project", ...definition(), semanticFingerprint: "foreign", fullFingerprint: "foreign" }).returning();
  try {
    for (const patch of [{ observationId: foreignObservation.id }, { sentByRemovalId: removal.id }, { sendReservedBySubmissionId: submission.id }, { kind: "zero" as const, confirmedForRemovalId: removal.id }]) {
      await expect(db.update(emissionEntries).set(patch).where(eq(emissionEntries.id, entry.id))).rejects.toThrow();
    }
  } finally {
    await db.delete(removalTemplateObservations).where(eq(removalTemplateObservations.id, foreignObservation.id));
    await db.delete(certificationSubmissions).where(eq(certificationSubmissions.id, submission.id));
    await db.delete(certifierRemovals).where(eq(certifierRemovals.id, removal.id));
    await db.delete(facilities).where(eq(facilities.id, facility.id));
  }
});

it("keeps a new unsent entry editable after the batch's earlier Removal was submitted", async () => {
  const [submitted] = await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: lineage.removalId, version: submissionIds.length + 1, status: "submitted", submittedAt: new Date(), externalId: "fixture-remote-removal" }).returning();
  submissionIds.push(submitted.id);
  await db.update(creditBatches).set({ productionEmissionsClaimedByRemovalId: lineage.removalId }).where(eq(creditBatches.id, lineage.batchId));
  const entry = await create();
  const updated = await updateEmissionEntry(ctx, { id: entry.id, expectedVersion: entry.version, note: "Later entry" });
  expect(updated.version).toBe(entry.version + 1);
  await expect(insertDocument(ctx, { entityType: "emission_entry", entityId: entry.id, documentType: "pdf", fileUrl: "https://example.test/later-evidence", fileName: "Evidence" })).resolves.toMatchObject({ entityId: entry.id });
});
