import { afterEach, beforeEach, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, creditBatches, creditBatchProductionRuns, facilities, organizations, productionRuns, samples, documents, users, binMovements, outputStockAllocations, applications, creditBatchApplications, certifierRemovals, certifierGhgStatements, transportLegs, productionSamples, deliveries } from "@/db/schema";
import { TEST_SITE_POSITION } from "../../tests/helpers/test-org";
import { readCreditBatchActivity, readCreditBatchActivitySummary } from "@/lib/read-models/credit-batch-activity";
import { runOperationInProcess } from "@/lib/operations/runner";
import { requestDocumentUploadApp, deleteDocumentApp } from "@/lib/operations/documents";
import { __setStorageProviderForTests } from "@/lib/storage";
import { RetirementStorageProvider } from "../../tests/helpers/document-retirement";
import type { OrgContext } from "@/lib/auth/server";
import { createActivityWriteFixture, cleanupActivityWriteFixture } from "../../tests/helpers/activity-write-fixture";
import { recordMembershipActivity, recordScopedWriteActivity } from "./write-activity";
import { getCreditBatchActivitySummary, listCreditBatchActivity } from "./credit-batch-activity";

let ctx: OrgContext;
let fixture: Awaited<ReturnType<typeof createActivityWriteFixture>>;
let foreignOrg: string;
const TIME = new Date("2026-10-15T10:00:00.123Z");
async function event(overrides: Partial<typeof activityEvents.$inferInsert> = {}) {
  const [row] = await db.insert(activityEvents).values({
    organizationId: ctx.organizationId, entityType: "credit_batch", entityId: fixture.batch.id,
    creditBatchId: fixture.batch.id, action: "updated", source: "system", occurredAt: TIME, ...overrides,
  }).returning();
  return row;
}
beforeEach(async () => {
  ctx = { organizationId: `activity_read_${crypto.randomUUID()}`, userId: crypto.randomUUID(), orgRole: "owner", isPlatformAdmin: false };
  fixture = await createActivityWriteFixture(ctx);
  __setStorageProviderForTests(new RetirementStorageProvider());
  foreignOrg = `activity_foreign_${crypto.randomUUID()}`;
  await db.insert(organizations).values({ id: foreignOrg, slug: foreignOrg, name: "Foreign fixture" });
});
afterEach(async () => {
  __setStorageProviderForTests(null);
  if (foreignOrg) await db.delete(organizations).where(eq(organizations.id, foreignOrg));
  if (ctx) {
    await db.delete(creditBatchApplications).where(eq(creditBatchApplications.organizationId, ctx.organizationId));
    await db.delete(certifierRemovals).where(eq(certifierRemovals.organizationId, ctx.organizationId));
    await db.delete(certifierGhgStatements).where(eq(certifierGhgStatements.organizationId, ctx.organizationId));
    await db.delete(productionSamples).where(eq(productionSamples.organizationId, ctx.organizationId));
    await cleanupActivityWriteFixture(ctx);
  }
});
it("isolates batch and member matches by organization and rejects a foreign batch", async () => {
  const own = await event();
  await event({ organizationId: foreignOrg });
  await event({ organizationId: foreignOrg, creditBatchId: null, productionRunId: fixture.run.id });
  expect((await listCreditBatchActivity(ctx, fixture.batch.id, {})).items.map(row => row.id)).toEqual([own.id]);
  expect(await listCreditBatchActivity({ ...ctx, organizationId: foreignOrg }, fixture.batch.id, {}))
    .toEqual({ items: [], nextCursor: null });
});
it("finds unlinked member records and runs, without duplicating multiple matches", async () => {
  const feedstock = await event({ entityType: "feedstock", entityId: fixture.feedstock.id, creditBatchId: null });
  const run = await event({ entityType: "production_run", entityId: fixture.run.id, productionRunId: fixture.run.id });
  const product = await event({ entityType: "biochar_product", entityId: fixture.product.id, creditBatchId: null });
  expect((await listCreditBatchActivity(ctx, fixture.batch.id)).items.map(row => row.id)).toEqual([product.id, run.id, feedstock.id]);
});
it("lists and summarizes linked events and resolvable members despite invalid downstream delivery provenance", async () => {
  await db.update(deliveries).set({ massDryKg: null }).where(and(
    eq(deliveries.id, fixture.delivery.id), eq(deliveries.organizationId, ctx.organizationId),
  ));
  const linked = await event();
  const feedstock = await event({ entityType: "feedstock", entityId: fixture.feedstock.id, creditBatchId: null });
  const page = await listCreditBatchActivity(ctx, fixture.batch.id);
  expect(page.items.map(row => row.id)).toEqual([feedstock.id, linked.id]);
  expect(await getCreditBatchActivitySummary(ctx, fixture.batch.id)).toEqual({
    total: 2,
    counts: [
      { entityType: "credit_batch", action: "updated", count: 1 },
      { entityType: "feedstock", action: "updated", count: 1 },
    ],
    latest: page.items[0],
  });
});
it("drops detached run activity but preserves the explicitly linked detach event", async () => {
  await event({ entityType: "production_run", entityId: fixture.run.id, productionRunId: fixture.run.id, creditBatchId: null });
  const detach = await event({ entityType: "production_run", entityId: fixture.run.id, productionRunId: fixture.run.id, reasonCode: "detached" });
  await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, ctx.organizationId));
  await event({ entityType: "production_run", entityId: fixture.run.id, productionRunId: fixture.run.id, creditBatchId: null });
  expect((await listCreditBatchActivity(ctx, fixture.batch.id)).items.map(row => row.id)).toEqual([detach.id]);
});
it("continues after the last timestamp and sequence despite newer inserts", async () => {
  const first = await event();
  const second = await event();
  const third = await event();
  const page = await listCreditBatchActivity(ctx, fixture.batch.id, { limit: 2 });
  expect(page.items.map(row => row.id)).toEqual([third.id, second.id]);
  await event({ occurredAt: new Date("2026-10-16T00:00:00Z") });
  const next = await listCreditBatchActivity(ctx, fixture.batch.id, { limit: 2, cursor: page.nextCursor! });
  expect(next.items.map(row => row.id)).toEqual([first.id]);
  expect(next.nextCursor).toBeNull();
});
it("filters the list by kind and record type while the summary counts everything", async () => {
  const created = await event({ action: "created" });
  await event();
  const run = await event({ entityType: "production_run", entityId: fixture.run.id, productionRunId: fixture.run.id });
  expect((await listCreditBatchActivity(ctx, fixture.batch.id, {}, { action: "created" })).items.map(row => row.id)).toEqual([created.id]);
  expect((await listCreditBatchActivity(ctx, fixture.batch.id, {}, { entityType: "production_run" })).items.map(row => row.id)).toEqual([run.id]);
  expect((await listCreditBatchActivity(ctx, fixture.batch.id, {}, { action: "created", entityType: "production_run" })).items).toEqual([]);
  expect((await readCreditBatchActivity(ctx, { creditBatchId: fixture.batch.id, action: "created" })).items.map(row => row.id)).toEqual([created.id]);
  await expect(readCreditBatchActivity(ctx, { creditBatchId: fixture.batch.id, action: "archived" })).rejects.toThrow();
  expect((await getCreditBatchActivitySummary(ctx, fixture.batch.id)).total).toBe(3);
});
it.each(["", "garbage", Buffer.from('{"occurredAt":"invalid","sequence":"1"}').toString("base64url")])("rejects malformed cursor %s", async cursor => {
  await expect(listCreditBatchActivity(ctx, fixture.batch.id, { cursor })).rejects.toThrow("Invalid activity cursor");
});
it("returns current actor and record names and actorless sources", async () => {
  await db.update(users).set({ name: "Activity reader" }).where(eq(users.id, ctx.userId));
  await event({ source: "form", actorUserId: ctx.userId });
  const system = await event();
  const registry = await event({ source: "registry" });
  const page = await listCreditBatchActivity(ctx, fixture.batch.id);
  expect(page.items.slice(0, 2).map(row => [row.id, row.actor])).toEqual([[registry.id, null], [system.id, null]]);
  expect(page.items[2].actor).toEqual({ id: ctx.userId, name: "Activity reader" });
  expect(page.items[2].record).toEqual({ label: "ACT-CB", deleted: false, facilityId: fixture.facility.id });
});
it("retains deleted record history as a tombstone", async () => {
  const [sample] = await db.insert(samples).values({ organizationId: ctx.organizationId, creditBatchId: fixture.batch.id,
    sampleCode: "ACT-SAMPLE", samplingTime: TIME, totalCarbonPercent: 80, organicCarbonPercent: 75 }).returning();
  const deletedId = sample.id;
  const deleted = await event({ entityType: "lab_sample", entityId: deletedId, action: "deleted" });
  await db.delete(samples).where(and(eq(samples.id, deletedId), eq(samples.organizationId, ctx.organizationId)));
  const page = await listCreditBatchActivity(ctx, fixture.batch.id);
  expect(page.items[0]).toMatchObject({ id: deleted.id, record: { label: null, deleted: true } });
});

it("finds unlinked documents through member owners without exposing filenames", async () => {
  const [document] = await db.insert(documents).values({ organizationId: ctx.organizationId,
    entityType: "feedstock", entityId: fixture.feedstock.id, documentType: "weighbridge_ticket",
    fileName: "private-filename.pdf", fileUrl: "https://example.test/private" }).returning();
  await event({ entityType: "document", entityId: document.id, creditBatchId: null, reasonCode: "document:weighbridge_ticket:feedstock" });
  const page = await listCreditBatchActivity(ctx, fixture.batch.id);
  expect(page.items).toHaveLength(1);
  expect(page.items[0].record).toEqual({ label: "Document", deleted: false, facilityId: null });
  expect(JSON.stringify(page)).not.toContain("private-filename");
});

it("finds stock movement history through member allocations when the writer has no single run link", async () => {
  const [movement] = await db.insert(binMovements).values({ organizationId: ctx.organizationId,
    storageLocationId: fixture.run.biocharStorageLocationId!, lane: "biochar", movementType: "loss",
    massDeltaKg: -1, reason: "Fixture loss" }).returning();
  await db.insert(outputStockAllocations).values({ organizationId: ctx.organizationId,
    movementId: movement.id, sourceStorageLocationId: fixture.run.biocharStorageLocationId!,
    productionRunId: fixture.run.id, dryMassKg: "1", basisSnapshot: {} });
  const recorded = await event({ entityType: "bin_movement", entityId: movement.id, creditBatchId: null });
  expect((await listCreditBatchActivity(ctx, fixture.batch.id)).items).toEqual([
    expect.objectContaining({ id: recorded.id, record: { label: "Lost mass", deleted: false, facilityId: null } }),
  ]);
});

it("finds aggregate Removal and GHG Statement events through the batch slices", async () => {
  const organizationId = ctx.organizationId;
  const [statement] = await db.insert(certifierGhgStatements).values({ organizationId, facilityId: fixture.facility.id, reportingPeriodEndOn: "2026-01-31" }).returning();
  const [removal] = await db.insert(certifierRemovals).values({ organizationId, facilityId: fixture.facility.id, ghgStatementId: statement.id }).returning();
  const [application] = await db.insert(applications).values({ organizationId, deliveryId: fixture.delivery.id,
    code: "ACT-APP", applicationDate: TIME, biocharAppliedTons: 0.01, biocharAppliedDryTons: 0.008, fieldSizeHa: 1 }).returning();
  await db.insert(creditBatchApplications).values({ organizationId, creditBatchId: fixture.batch.id,
    applicationId: application.id, removalId: removal.id, allocatedWetMassKg: 10, allocatedDryMassKg: 8 });
  const removalEvent = await event({ entityType: "removal", entityId: removal.id, creditBatchId: null });
  const statementEvent = await event({ entityType: "ghg_statement", entityId: statement.id, creditBatchId: null });
  const items = (await listCreditBatchActivity(ctx, fixture.batch.id)).items;
  expect(items.map(row => row.id)).toEqual([statementEvent.id, removalEvent.id]);
  expect(items.map(row => row.record.facilityId)).toEqual([fixture.facility.id, fixture.facility.id]);
});
it("links each record to the facility it lives at now, and a document to its owner's", async () => {
  const [elsewhere] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: ctx.organizationId,
    code: "ACT-FAC-2", name: "Activity second facility", timezone: "UTC" }).returning();
  // A run detached from the batch and moved keeps its history; its link must follow it.
  await db.update(productionRuns).set({ facilityId: elsewhere.id })
    .where(and(eq(productionRuns.id, fixture.run.id), eq(productionRuns.organizationId, ctx.organizationId)));
  const [sample] = await db.insert(samples).values({ organizationId: ctx.organizationId, creditBatchId: fixture.batch.id,
    sampleCode: "ACT-FACILITY", samplingTime: TIME, totalCarbonPercent: 80, organicCarbonPercent: 75 }).returning();
  const [document] = await db.insert(documents).values({ organizationId: ctx.organizationId,
    entityType: "production_run", entityId: fixture.run.id, documentType: "lab_report", fileName: "f.pdf", fileUrl: "https://example.test/f" }).returning();
  const run = await event({ entityType: "production_run", entityId: fixture.run.id });
  const sampleEvent = await event({ entityType: "lab_sample", entityId: sample.id });
  const documentEvent = await event({ entityType: "document", entityId: document.id, reasonCode: `document:lab_report:production_run:${fixture.run.id}` });
  const orphanDocument = await event({ entityType: "document", entityId: crypto.randomUUID(), reasonCode: `document:lab_report:production_run:${fixture.run.id}` });
  const byId = new Map((await listCreditBatchActivity(ctx, fixture.batch.id)).items.map(row => [row.id, row.record]));
  expect(byId.get(run.id)).toEqual({ label: fixture.run.code, deleted: false, facilityId: elsewhere.id });
  expect(byId.get(sampleEvent.id)?.facilityId).toBe(fixture.facility.id);
  expect(byId.get(documentEvent.id)).toEqual({ label: "Document", deleted: false, facilityId: elsewhere.id });
  expect(byId.get(orphanDocument.id)).toEqual({ label: null, deleted: true, facilityId: null });
});
it("reads malformed owner ids in legacy document reason codes as no link instead of failing", async () => {
  const [document] = await db.insert(documents).values({ organizationId: ctx.organizationId,
    entityType: "production_run", entityId: fixture.run.id, documentType: "lab_report", fileName: "f.pdf", fileUrl: "https://example.test/f" }).returning();
  const malformed = await event({ entityType: "document", entityId: document.id, reasonCode: "document:lab_report:production_run:not-a-uuid" });
  const page = await listCreditBatchActivity(ctx, fixture.batch.id);
  expect(page.items.find(row => row.id === malformed.id)?.record).toEqual({ label: "Document", deleted: false, facilityId: null });
});
it("finds sample transport events even without batch or run links", async () => {
  const [sample] = await db.insert(samples).values({ organizationId: ctx.organizationId, creditBatchId: fixture.batch.id,
    sampleCode: "ACT-TRANSPORT", samplingTime: TIME, totalCarbonPercent: 80, organicCarbonPercent: 75 }).returning();
  const [leg] = await db.insert(transportLegs).values({ organizationId: ctx.organizationId,
    entityType: "sample", entityId: sample.id, distanceKm: 10, loadMassKg: 1, transportMethodType: "road",
    originName: "Facility", destinationName: "Lab" }).returning();
  const recorded = await event({ entityType: "transport_leg", entityId: leg.id, creditBatchId: null });
  expect((await listCreditBatchActivity(ctx, fixture.batch.id)).items).toEqual([
    expect.objectContaining({ id: recorded.id, record: { label: "Facility to Lab", deleted: false, facilityId: null } }),
  ]);
});

it("includes documents owned by a member run's in-process measurements", async () => {
  const [measurement] = await db.insert(productionSamples).values({ organizationId: ctx.organizationId,
    productionRunId: fixture.run.id, timestamp: TIME }).returning();
  const [document] = await db.insert(documents).values({ organizationId: ctx.organizationId,
    entityType: "production_sample", entityId: measurement.id, documentType: "photo",
    fileName: "private-photo.jpg", fileUrl: "https://example.test/photo" }).returning();
  const recorded = await event({ entityType: "document", entityId: document.id, creditBatchId: null });
  expect((await listCreditBatchActivity(ctx, fixture.batch.id)).items.map(row => row.id)).toEqual([recorded.id]);
});

async function secondBatch() {
  const [batch] = await db.insert(creditBatches).values({ ...fixture.batch, organizationId: ctx.organizationId, id: crypto.randomUUID(), code: "ACT-CB-2" }).returning();
  return batch;
}

it("lists one application event per batch when the writer fans out", async () => {
  const batch = await secondBatch();
  const [application] = await db.insert(applications).values({ organizationId: ctx.organizationId,
    deliveryId: fixture.delivery.id, code: "ACT-SPLIT", applicationDate: TIME,
    biocharAppliedTons: 0.01, biocharAppliedDryTons: 0.008, fieldSizeHa: 1 }).returning();
  await db.insert(creditBatchApplications).values([fixture.batch.id, batch.id].map(creditBatchId => ({
    organizationId: ctx.organizationId, creditBatchId, applicationId: application.id,
    allocatedWetMassKg: 5, allocatedDryMassKg: 4,
  })));
  await db.transaction(tx => recordScopedWriteActivity(ctx, tx, {
    entityType: "application", entityId: application.id, action: "updated", source: "form",
  }, [{ creditBatchId: fixture.batch.id }, { creditBatchId: batch.id }]));
  for (const id of [fixture.batch.id, batch.id]) {
    const page = await listCreditBatchActivity(ctx, id);
    expect(page.items).toHaveLength(1);
    expect(await getCreditBatchActivitySummary(ctx, id)).toMatchObject({ total: 1, counts: [{ entityType: "application", action: "updated", count: 1 }], latest: page.items[0] });
    expect(page.items[0]).toMatchObject({ entityId: application.id, action: "updated" });
  }
});

it("keeps each batch's membership writer events after moving a run", async () => {
  const batch = await secondBatch();
  await db.transaction(async tx => {
    await recordMembershipActivity(ctx, tx, fixture.batch.id, [fixture.run.id], []);
    await tx.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, ctx.organizationId));
    await tx.insert(creditBatchProductionRuns).values({ organizationId: ctx.organizationId,
      creditBatchId: batch.id, productionRunId: fixture.run.id });
    await recordMembershipActivity(ctx, tx, batch.id, [], [fixture.run.id]);
  });
  for (const [id, reason] of [[fixture.batch.id, "detached"], [batch.id, "attached"]]) {
    const page = await listCreditBatchActivity(ctx, id);
    expect(page.items).toHaveLength(2);
    expect(page.items.find(row => row.entityType === "credit_batch")?.entityId).toBe(id);
    expect(page.items.find(row => row.entityType === "production_run")?.reasonCode).toBe(reason);
  }
});

it("summarizes all events independently of page size and isolates tenants", async () => {
  await event({ action: "created" });
  await event();
  const latest = await event({ source: "form", actorUserId: ctx.userId });
  await event({ organizationId: foreignOrg, occurredAt: new Date("2026-10-16") });
  await event({ organizationId: foreignOrg, creditBatchId: null, productionRunId: fixture.run.id });
  const summary = await getCreditBatchActivitySummary(ctx, fixture.batch.id);
  expect(summary.total).toBe(3);
  expect(summary.counts).toEqual([
    { entityType: "credit_batch", action: "created", count: 1 },
    { entityType: "credit_batch", action: "updated", count: 2 },
  ]);
  expect(summary.latest).toMatchObject({ id: latest.id, actor: { id: ctx.userId }, record: { label: "ACT-CB", deleted: false } });
  expect(summary.latest).toEqual((await listCreditBatchActivity(ctx, fixture.batch.id, { limit: 1 })).items[0]);
  expect(await getCreditBatchActivitySummary({ ...ctx, organizationId: foreignOrg }, fixture.batch.id))
    .toEqual({ total: 0, counts: [], latest: null });
});

async function createAndDeleteDocument(entityType: "feedstock" | "sample", entityId: string) {
  const document = await runOperationInProcess(requestDocumentUploadApp, ctx, {
    entityType, entityId, documentType: "pdf", fileName: "evidence.pdf",
    contentType: "application/pdf", sizeBytes: 8, storageProvider: "local-fs", storageBucket: "local-fs",
  });
  await runOperationInProcess(deleteDocumentApp, ctx, { documentId: document.id, expectedVersion: document.version });
  return document;
}

it.each(["feedstock", "sample"] as const)("retains real %s document create/delete events as tombstones and excludes another batch", async ownerType => {
  const otherBatch = await secondBatch();
  const sampleRows = await db.insert(samples).values([fixture.batch.id, otherBatch.id].map((creditBatchId, index) => ({
    organizationId: ctx.organizationId, creditBatchId, sampleCode: `ACT-DOC-${index}`,
    samplingTime: TIME, totalCarbonPercent: 80, organicCarbonPercent: 75,
  }))).returning();
  await createAndDeleteDocument("sample", sampleRows[1].id);
  const document = await createAndDeleteDocument(ownerType, ownerType === "feedstock" ? fixture.feedstock.id : sampleRows[0].id);
  const reasonCode = `document:pdf:${ownerType}:${document.entityId}`;
  const page = await listCreditBatchActivity(ctx, fixture.batch.id);
  expect(page.items).toEqual([
    expect.objectContaining({ entityId: document.id, reasonCode, action: "deleted", record: { label: null, deleted: true, facilityId: null } }),
    expect.objectContaining({ entityId: document.id, reasonCode, action: "created", record: { label: null, deleted: true, facilityId: null } }),
  ]);
  expect(await getCreditBatchActivitySummary(ctx, fixture.batch.id)).toEqual({
    total: 2, counts: [
      { entityType: "document", action: "created", count: 1 },
      { entityType: "document", action: "deleted", count: 1 },
    ], latest: page.items[0],
  });
});

it("matches document reason owners only at the end after the document prefix", async () => {
  const owner = `feedstock:${fixture.feedstock.id}`;
  const valid = await event({ entityType: "document", entityId: crypto.randomUUID(), creditBatchId: null,
    reasonCode: `document:custom:type:${owner}` });
  for (const reasonCode of [`document:${owner}:sample:${crypto.randomUUID()}`, `other:document:pdf:${owner}`, `document:pdf:sample:${fixture.feedstock.id}`]) {
    await event({ entityType: "document", entityId: crypto.randomUUID(), creditBatchId: null, reasonCode });
  }
  await event({ entityType: "feedstock", entityId: crypto.randomUUID(), creditBatchId: null, reasonCode: `document:pdf:${owner}` });
  await event({ entityType: "document", entityId: crypto.randomUUID(), creditBatchId: (await secondBatch()).id, reasonCode: `document:pdf:${owner}` });
  expect((await listCreditBatchActivity(ctx, fixture.batch.id)).items.map(row => row.id)).toEqual([valid.id]);
  expect(await getCreditBatchActivitySummary(ctx, fixture.batch.id)).toMatchObject({ total: 1, latest: { id: valid.id } });
});

it("returns the same list and summary for uppercase and lowercase batch IDs", async () => {
  const recorded = await event();
  const input = { creditBatchId: fixture.batch.id };
  const uppercase = { creditBatchId: fixture.batch.id.toUpperCase() };
  const page = await readCreditBatchActivity(ctx, input);
  expect(page.items.map(row => row.id)).toEqual([recorded.id]);
  expect(await readCreditBatchActivity(ctx, uppercase)).toEqual(page);
  const summary = await readCreditBatchActivitySummary(ctx, input);
  expect(summary.total).toBe(1);
  expect(await readCreditBatchActivitySummary(ctx, uppercase)).toEqual(summary);
});

it("returns captured IDs with current org-scoped link names and tombstones for missing targets", async () => {
  const missing = crypto.randomUUID();
  const changes = { credit_batch: { from: missing, to: fixture.batch.id } };
  const saved = await event({ entityType: "production_run", entityId: fixture.run.id, changedFields: ["credit_batch"], changes });
  const renamedCode = "ACT-CB-RENAMED";
  await db.update(creditBatches).set({ code: renamedCode }).where(and(eq(creditBatches.id, fixture.batch.id), eq(creditBatches.organizationId, ctx.organizationId)));
  const page = await listCreditBatchActivity(ctx, fixture.batch.id);
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({ id: saved.id, changes, changeLabels: { credit_batch: { from: { label: null, deleted: true, type: "credit_batch" }, to: { label: renamedCode, deleted: false, type: "credit_batch" } } } });
  // A live ID belonging to another org must look just like a deleted ID.
  const [foreign] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: foreignOrg, timezone: "UTC", code: "FOREIGN", name: "Foreign private name" }).returning();
  try {
    await event({ changes: { facilityId: { from: foreign.id, to: fixture.facility.id } } });
    const rows = await listCreditBatchActivity(ctx, fixture.batch.id);
    expect(rows.items).toHaveLength(2);
    expect(rows.items[0].changeLabels?.facilityId).toEqual({ from: { label: null, deleted: true, type: "facility" }, to: { label: fixture.facility.name, deleted: false, type: "facility" } });
    expect(JSON.stringify(rows)).not.toContain(foreign.name);
  } finally {
    await db.delete(facilities).where(and(eq(facilities.id, foreign.id), eq(facilities.organizationId, foreignOrg)));
  }
});

it("keeps null sides, deleted suppliers and unlabeled targets distinct without exposing IDs", async () => {
  const { resolveActivityRecords, activityChangeLabels } = await import("./activity-record-labels");
  const missing = crypto.randomUUID();
  const [submission] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId,
    submissionType: "production_batch", localEntityType: "credit_batch", localEntityId: fixture.batch.id }).returning();
  const events: { entityType: string; entityId: string; action: string; changes: import("@/db/schema/activity").ActivityChanges }[] = [
    { entityType: "feedstock", entityId: fixture.run.id, action: "updated", changes: { supplierId: { from: missing, to: null } } },
    { entityType: "credit_batch", entityId: fixture.batch.id, action: "updated", changes: { removalTemplateId: { from: null, to: missing }, productionProcessId: { from: missing, to: fixture.batch.productionProcessId }, productionEmissionsClaimReservedBySubmissionId: { from: null, to: submission.id } } },
  ];
  const records = await resolveActivityRecords(ctx, events);
  expect(activityChangeLabels("feedstock", events[0].changes, records)).toEqual({ supplierId: { from: { label: null, deleted: true, type: "supplier" }, to: null } });
  expect(activityChangeLabels("credit_batch", events[1].changes, records)).toEqual({
    removalTemplateId: { from: null, to: { label: null, deleted: false, type: null } },
    productionProcessId: { from: { label: null, deleted: true, type: "production_process" }, to: { label: null, deleted: false, type: "production_process" } },
    productionEmissionsClaimReservedBySubmissionId: { from: null, to: { label: null, deleted: false, type: "submission" } },
  });
  await db.delete(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.id, submission.id)));
});

it("omits change values and link lookups for created and deleted events", async () => {
  const { resolveActivityRecords } = await import("./activity-record-labels");
  const supplierId = crypto.randomUUID();
  for (const action of ["created", "deleted"] as const) {
    const saved = await event({ entityType: "feedstock", entityId: fixture.feedstock.id, action,
      changedFields: ["supplierId"], changes: { supplierId: { from: null, to: supplierId } } });
    const records = await resolveActivityRecords(ctx, [saved]);
    expect(records.has(`supplier:${supplierId}`)).toBe(false);
  }
  const page = await listCreditBatchActivity(ctx, fixture.batch.id);
  expect(page.items).toHaveLength(2);
  for (const row of page.items) {
    expect(row.changedFields).toEqual(["supplierId"]);
    expect(row).not.toHaveProperty("changes");
    expect(row).not.toHaveProperty("changeLabels");
  }
});
