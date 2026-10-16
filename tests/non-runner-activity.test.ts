import { stringifyWithBigint } from "./helpers/api-activity";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, applications, creditBatches, creditBatchProductionRuns, documents, productionRuns, samples, transportLegs, biocharProducts, biocharProductSourceAllocations, vehicles, feedstocks, outputStockAllocations, outputStockRunAllocations, binMovements, deliveries, applicationOutputAllocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { formatUtcDate } from "@/lib/date-utils";
import * as activity from "@/data-access/activity-events";
import { recordApplication, updateApplication as updateApplicationOperation, deleteApplication as deleteApplicationOperation } from "@/lib/operations/applications";
import { createCreditBatch, updateCreditBatch, deleteCreditBatch } from "@/data-access/credit-batches";
import { attachProductionRunToMatchingCreditBatch } from "@/data-access/credit-batch-membership";
import { insertDocument, deleteDocumentRow, retireDocumentsForEntities } from "@/data-access/documents";
import { __setStorageProviderForTests } from "@/lib/storage";
import { RetirementStorageProvider } from "./helpers/document-retirement";
import { DOCUMENT_FAILED_RETENTION_MS, DOCUMENT_UPLOAD_GRACE_MS } from "@/config/documents";
import { expireDocumentUploadsInTransaction, retireFailedDocumentUploadsInTransaction } from "@/data-access/document-upload-sweep";
import { uploadFactsFor } from "@/data-access/document-writes";
import { createTransportLeg, updateTransportLeg, deleteTransportLeg, deleteTransportLegsForEntity, syncFeedstockTransportLeg } from "@/data-access/transport-legs";
import { ACTIVITY_FIXTURE_DATE, cleanupActivityWriteFixture, createActivityWriteFixture } from "./helpers/activity-write-fixture";

import { insertOutputDeliveryFixture } from "./helpers/output-contract-fixtures";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { requestDocumentUploadApp, confirmDocumentUploadApp, deleteDocumentApp } from "@/lib/operations/documents";
import { updateFeedstock } from "@/lib/operations/feedstocks";
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { updateVehicle } from "@/data-access/vehicles";
import { resolveWriteActivityScopes } from "@/data-access/write-activity";
import { deleteLabSample } from "@/lib/operations/lab-samples";

const LEG_DISTANCE_KM = 10;
const UPDATED_LEG_DISTANCE_KM = 20;
const DERIVED_LEG_DISTANCE_KM = 10.1;
const LEG_LOAD_MASS_KG = 100;
const SAMPLE_TOTAL_CARBON_PERCENT = 80;
const SAMPLE_ORGANIC_CARBON_PERCENT = 75;
const INITIAL_MODEL_YEAR = 2020;
const UPDATED_MODEL_YEAR = 2024;
const APPLICATION_WET_KG = 10;
const DOCUMENT_SIZE_BYTES = 8;
const SHA256_HEX_LENGTH = 64;
const RETENTION_BOUNDARY_OFFSET_MS = 1;
const NEXT_ACTIVITY_DATE = new Date("2026-02-10T10:00:00Z");
const NEXT_RUN_START = new Date("2026-02-10T09:00:00Z");
const OTHER_RUN_START = new Date("2026-01-10T08:00:00Z");
const PRIVATE_FILENAME = "Private Person confidential evidence.pdf";
const FAILURE = new Error("Injected failure after activity insert");
let ctx: OrgContext;
let fixture: Awaited<ReturnType<typeof createActivityWriteFixture>>;

beforeEach(async () => {
  ctx = { organizationId: `activity-writes-${crypto.randomUUID()}`, userId: `activity-actor-${crypto.randomUUID()}`, orgRole: "owner", isPlatformAdmin: false };
  fixture = await createActivityWriteFixture(ctx);
  __setStorageProviderForTests(new RetirementStorageProvider());
});
afterEach(async () => {
  vi.restoreAllMocks();
  __setStorageProviderForTests(null);
  if (ctx) await cleanupActivityWriteFixture(ctx);
});

function calendarDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
function applicationInput() {
  return { deliveryId: fixture.delivery.id, applicationDate: calendarDate(ACTIVITY_FIXTURE_DATE), appliedWetMassKg: APPLICATION_WET_KG, fieldSizeHa: 1, evidenceMethod: "location" as const, gpsLatitude: 1, gpsLongitude: 1 };
}
// Application writes run on the operation runner, which records their activity.
async function createApplication(_ctx: OrgContext, input: ReturnType<typeof applicationInput>) {
  return (await runOperationInProcess(recordApplication, _ctx, input)).application;
}
async function updateApplication(_ctx: OrgContext, applicationId: string, input: Record<string, unknown>) {
  return (await runOperationInProcess(updateApplicationOperation, _ctx, { ...input, applicationId })).application;
}
function deleteApplication(_ctx: OrgContext, applicationId: string, expectedVersion: number) {
  return runOperationInProcess(deleteApplicationOperation, _ctx, { applicationId, expectedVersion });
}
function batchInput() {
  return { code: "ACT-CB-NEW", facilityId: fixture.facility.id, feedstockTypeId: fixture.feedstockType.id, startDate: new Date("2026-02-01"), endDate: new Date("2026-02-28"), productionRunIds: [] };
}
function documentInput(entityType = "credit_batch", entityId = fixture.batch.id) {
  return { entityType, entityId, documentType: "pdf" as const, fileName: PRIVATE_FILENAME, fileUrl: "https://example.invalid/evidence.pdf" };
}
function legInput() {
  return { entityType: "feedstock" as const, entityId: fixture.feedstock.id, distanceKm: LEG_DISTANCE_KM, loadMassKg: LEG_LOAD_MASS_KG, transportMethodType: "road" as const };
}
async function insertSample() {
  const [sample] = await db.insert(samples).values({
    organizationId: ctx.organizationId, creditBatchId: fixture.batch.id,
    sampleCode: "ACT-SAMPLE", samplingTime: ACTIVITY_FIXTURE_DATE,
    totalCarbonPercent: SAMPLE_TOTAL_CARBON_PERCENT, organicCarbonPercent: SAMPLE_ORGANIC_CARBON_PERCENT,
  }).returning();
  return sample;
}
function events(entityType: Parameters<typeof activity.listEntityActivity>[1], id: string) {
  return activity.listEntityActivity(ctx, entityType, id);
}
async function allEvents() {
  return db.select().from(activityEvents).where(eq(activityEvents.organizationId, ctx.organizationId));
}

it("records exactly one event for each application write with its batch and source run", async () => {
  const created = await createApplication(ctx, applicationInput());
  const updated = await updateApplication(ctx, created.id, { expectedVersion: created.version, cropType: "private crop value" });
  await deleteApplication(ctx, updated.id, updated.version);
  const rows = await events("application", created.id);
  expect(rows.map(row => row.action)).toEqual(["deleted", "updated", "created"]);
  for (const row of rows) expect(row).toMatchObject({ creditBatchId: fixture.batch.id, productionRunId: fixture.run.id, source: "form", actorUserId: ctx.userId });
  expect(rows[1].changedFields).toEqual(["cropType"]);
  expect(stringifyWithBigint(rows)).not.toContain("private crop value");
});

it.each(["different", "same", "unbatched"] as const)("records both run scopes when moving applications between %s batches", async batchScope => {
  if (batchScope === "unbatched") await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, fixture.batch.id));
  const nextDate = batchScope === "same" ? ACTIVITY_FIXTURE_DATE : NEXT_ACTIVITY_DATE;
  const nextStart = batchScope === "same" ? OTHER_RUN_START : NEXT_RUN_START;
  const created = await createApplication(ctx, applicationInput());
  const [nextRun] = await db.insert(productionRuns).values({ ...fixture.run, id: crypto.randomUUID(), code: "ACT-RUN-NEXT", startTime: nextStart, endTime: nextDate }).returning();
  const [nextBatch] = await db.insert(creditBatches).values({ ...fixture.batch, id: crypto.randomUUID(), code: "ACT-CB-NEXT", startDate: "2026-02-01", endDate: "2026-02-28" }).returning();
  const previousBatchId = batchScope === "unbatched" ? null : fixture.batch.id;
  const nextBatchId = batchScope === "same" ? fixture.batch.id : batchScope === "unbatched" ? null : nextBatch.id;
  if (nextBatchId) await db.insert(creditBatchProductionRuns).values({ organizationId: ctx.organizationId, creditBatchId: nextBatchId, productionRunId: nextRun.id });
  const [nextProduct] = await db.insert(biocharProducts).values({ ...fixture.product, id: crypto.randomUUID(), code: "ACT-BP-NEXT", linkedProductionRunId: nextRun.id, productionDate: formatUtcDate(nextDate), placedAt: nextDate }).returning();
  await db.insert(biocharProductSourceAllocations).values({
    organizationId: ctx.organizationId, biocharProductId: nextProduct.id, productionRunId: nextRun.id,
    sourceStorageLocationId: nextRun.biocharStorageLocationId!, allocatedWetMassKg: nextRun.biocharOutputKg!, allocatedDryMassKg: nextRun.biocharDryMassKg!,
  });
  const [nextDelivery] = await insertOutputDeliveryFixture(db, {
    ...fixture.delivery, id: crypto.randomUUID(), code: "ACT-DL-NEXT", biocharProductId: nextProduct.id, deliveryDate: nextDate,
  }, row => row);
  await updateApplication(ctx, created.id, { expectedVersion: created.version, deliveryId: nextDelivery.id, applicationDate: calendarDate(nextDate) });
  const updates = (await events("application", created.id)).filter(row => row.action === "updated");
  expect(updates).toHaveLength(2);
  expect(updates).toEqual(expect.arrayContaining([
    expect.objectContaining({ creditBatchId: previousBatchId, productionRunId: fixture.run.id }),
    expect.objectContaining({ creditBatchId: nextBatchId, productionRunId: nextRun.id }),
  ]));
});

it("records batch create, scalar update and delete once each", async () => {
  const created = await createCreditBatch(ctx, batchInput());
  const updated = await updateCreditBatch(ctx, created.id, { expectedVersion: created.version, siteManagementNotes: "private notes" });
  await deleteCreditBatch(ctx, updated.id, updated.version);
  const rows = await events("credit_batch", created.id);
  expect(rows.map(row => row.action)).toEqual(["deleted", "updated", "created"]);
  expect(rows[1].changedFields).toEqual(["siteManagementNotes"]);
  for (const row of rows) expect(row.creditBatchId).toBe(created.id);
});

it("keeps detach history on a run after its batch is deleted", async () => {
  const updated = await updateCreditBatch(ctx, fixture.batch.id, { expectedVersion: fixture.batch.version, productionRunIds: [] });
  expect((await events("credit_batch", fixture.batch.id))[0].changedFields).toEqual(["production_runs"]);
  await deleteCreditBatch(ctx, updated.id, updated.version);
  const rows = await events("production_run", fixture.run.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ action: "updated", changedFields: ["credit_batch"], creditBatchId: fixture.batch.id, reasonCode: "detached" });
});

it("records manual attach and scalar edits as one batch update plus one run event", async () => {
  await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, fixture.batch.id));
  await updateCreditBatch(ctx, fixture.batch.id, { expectedVersion: fixture.batch.version, productionRunIds: [fixture.run.id], siteManagementNotes: "private notes" });
  const rows = await events("credit_batch", fixture.batch.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].changedFields).toEqual(["production_runs", "siteManagementNotes"]);
  expect(await events("production_run", fixture.run.id)).toMatchObject([{ reasonCode: "attached", changedFields: ["credit_batch"], creditBatchId: fixture.batch.id }]);
});

it("auto-attaches once with system source and a null actor on both events", async () => {
  await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, fixture.batch.id));
  await db.transaction(async tx => {
    expect(await attachProductionRunToMatchingCreditBatch(ctx, tx, fixture.run.id)).toBe(fixture.batch.id);
    expect(await attachProductionRunToMatchingCreditBatch(ctx, tx, fixture.run.id)).toBe(fixture.batch.id);
  });
  const rows = await allEvents();
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row).toMatchObject({ source: "system", actorUserId: null, action: "updated", creditBatchId: fixture.batch.id, productionRunId: fixture.run.id });
});

it("records a batch membership event per changed run so each event can be swept by run", async () => {
  const [otherRun] = await db.insert(productionRuns).values({ ...fixture.run, id: crypto.randomUUID(), code: "ACT-RUN-OTHER", startTime: OTHER_RUN_START, endTime: fixture.run.startTime }).returning();
  await db.insert(creditBatchProductionRuns).values({ organizationId: ctx.organizationId, creditBatchId: fixture.batch.id, productionRunId: otherRun.id });
  await updateCreditBatch(ctx, fixture.batch.id, { expectedVersion: fixture.batch.version, productionRunIds: [] });
  const batchEvents = await events("credit_batch", fixture.batch.id);
  expect(batchEvents).toHaveLength(2);
  expect(batchEvents.map(row => row.productionRunId).sort()).toEqual([fixture.run.id, otherRun.id].sort());
  for (const runId of [fixture.run.id, otherRun.id]) {
    expect(await events("production_run", runId)).toMatchObject([{ reasonCode: "detached", creditBatchId: fixture.batch.id }]);
  }
});

it("records legacy document create/delete without any filename", async () => {
  const deleteWriter = deleteDocumentRow;
  const document = await insertDocument(ctx, documentInput());
  await deleteWriter(ctx, document.id, "form");
  const rows = await events("document", document.id);
  expect(rows.map(row => row.action)).toEqual(["deleted", "created"]);
  for (const row of rows) expect(row).toMatchObject({ creditBatchId: fixture.batch.id, reasonCode: `document:pdf:credit_batch:${fixture.batch.id}`, changedFields: [] });
  expect(stringifyWithBigint(rows)).not.toContain(PRIVATE_FILENAME);
  expect(await deleteWriter(ctx, document.id, "form")).toBeNull();
  expect(await events("document", document.id)).toHaveLength(2);
});

it("records document retirement in its caller's transaction", async () => {
  const document = await insertDocument(ctx, documentInput("production_run", fixture.run.id));
  await db.transaction(tx => retireDocumentsForEntities(ctx, tx, [{ entityType: "production_run", entityId: fixture.run.id }], "form"));
  expect(await events("document", document.id)).toMatchObject([
    { action: "deleted", productionRunId: fixture.run.id, creditBatchId: fixture.batch.id },
    { action: "created", productionRunId: fixture.run.id, creditBatchId: fixture.batch.id },
  ]);
});

it("records transport-leg create/update/delete once with batch lineage", async () => {
  const created = await createTransportLeg(ctx, legInput());
  const updated = await updateTransportLeg(ctx, created.id, { expectedVersion: created.version, distanceKm: UPDATED_LEG_DISTANCE_KM });
  await deleteTransportLeg(ctx, updated.id, updated.version);
  const rows = await events("transport_leg", created.id);
  expect(rows.map(row => row.action)).toEqual(["deleted", "updated", "created"]);
  expect(rows[1].changedFields).toEqual(["distanceKm"]);
  for (const row of rows) expect(row.creditBatchId).toBe(fixture.batch.id);
});

it("records sample-owned transport and its documents against the sample's batch", async () => {
  const sample = await insertSample();
  const leg = await createTransportLeg(ctx, { ...legInput(), entityType: "sample", entityId: sample.id });
  const document = await insertDocument(ctx, documentInput("transport_leg", leg.id));
  expect((await events("transport_leg", leg.id))[0].creditBatchId).toBe(fixture.batch.id);
  expect((await events("document", document.id))[0].creditBatchId).toBe(fixture.batch.id);
});

it("records cascade transport deletes and document retirement with captured ownership", async () => {
  const leg = await createTransportLeg(ctx, legInput());
  const document = await insertDocument(ctx, documentInput("transport_leg", leg.id));
  await db.transaction(async tx => {
    const refs = await deleteTransportLegsForEntity(ctx, tx, "feedstock", fixture.feedstock.id, "form");
    await retireDocumentsForEntities(ctx, tx, refs, "form");
  });
  expect((await events("transport_leg", leg.id))[0]).toMatchObject({ action: "deleted", creditBatchId: fixture.batch.id });
  expect((await events("document", document.id))[0]).toMatchObject({ action: "deleted", creditBatchId: fixture.batch.id });
});

it("upserts identical derived syncs without events and records changed fields on a real update", async () => {
  await db.transaction(async tx => {
    await tx.update(feedstocks).set({ distanceKmOverride: DERIVED_LEG_DISTANCE_KM, distanceSource: "manual" }).where(eq(feedstocks.id, fixture.feedstock.id));
    await syncFeedstockTransportLeg(ctx, tx, fixture.feedstock.id, { refreshFromLocation: true });
  });
  const [leg] = await db.select().from(transportLegs).where(eq(transportLegs.organizationId, ctx.organizationId));
  await db.transaction(async tx => {
    await tx.update(feedstocks).set({ distanceKmOverride: DERIVED_LEG_DISTANCE_KM, distanceSource: "manual" }).where(eq(feedstocks.id, fixture.feedstock.id));
    await syncFeedstockTransportLeg(ctx, tx, fixture.feedstock.id, { refreshFromLocation: true });
  });
  expect(await events("transport_leg", leg.id)).toHaveLength(1);
  const [unchanged] = await db.select().from(transportLegs).where(eq(transportLegs.id, leg.id));
  expect(unchanged.version).toBe(leg.version + 1);
  expect(unchanged.updatedAt.getTime()).toBeGreaterThanOrEqual(leg.updatedAt.getTime());
  expect({ ...unchanged, version: leg.version, updatedAt: leg.updatedAt }).toEqual(leg);
  await db.transaction(async tx => {
    await tx.update(feedstocks).set({ distanceKmOverride: UPDATED_LEG_DISTANCE_KM, distanceSource: "manual" }).where(eq(feedstocks.id, fixture.feedstock.id));
    await syncFeedstockTransportLeg(ctx, tx, fixture.feedstock.id, { refreshFromLocation: true });
  });
  await db.transaction(async tx => {
    await tx.update(feedstocks).set({ distanceKmOverride: null, distanceSource: null }).where(eq(feedstocks.id, fixture.feedstock.id));
    await syncFeedstockTransportLeg(ctx, tx, fixture.feedstock.id, { refreshFromLocation: true });
  });
  const rows = await events("transport_leg", leg.id);
  expect(rows.map(row => row.action)).toEqual(["deleted", "updated", "created"]);
  expect(rows[1].changedFields).toEqual(["distanceKm"]);
  for (const row of rows) expect(row).toMatchObject({ source: "system", actorUserId: ctx.userId, creditBatchId: fixture.batch.id });
});

it.each(["form", "rest", "mcp", "script"] as const)("preserves %s source through lab-sample leg and document deletion", async source => {
  const sample = await insertSample();
  const leg = await createTransportLeg(ctx, { ...legInput(), entityType: "sample", entityId: sample.id });
  const sampleDocument = await insertDocument(ctx, documentInput("sample", sample.id));
  const legDocument = await insertDocument(ctx, documentInput("transport_leg", leg.id));
  const input = { labSampleId: sample.id, expectedVersion: sample.version };
  if (source === "form") await runOperationInProcess(deleteLabSample, ctx, input);
  else if (source === "script") await runOperation(deleteLabSample, ctx, input, { activitySource: source });
  else await runOperation(deleteLabSample, ctx, input, { audit: { transport: source, requestId: crypto.randomUUID(), credentialId: crypto.randomUUID() } });
  expect(await events("lab_sample", sample.id)).toMatchObject([
    { action: "deleted", source, actorUserId: source === "script" ? null : ctx.userId, creditBatchId: fixture.batch.id },
  ]);
  for (const [type, id] of [["transport_leg", leg.id], ["document", sampleDocument.id], ["document", legDocument.id]] as const) {
    expect((await events(type, id))[0]).toMatchObject({ action: "deleted", source, actorUserId: source === "script" ? null : ctx.userId, creditBatchId: fixture.batch.id });
  }
});

it.each(["application", "credit_batch", "document", "transport_leg"] as const)("rolls back a %s create when activity recording fails after insert", async type => {
  const original = activity.recordActivity;
  const spy = vi.spyOn(activity, "recordActivity").mockImplementationOnce(async (...args) => {
    await original(...args);
    throw FAILURE;
  });
  const write = {
    application: () => createApplication(ctx, applicationInput()),
    credit_batch: () => createCreditBatch(ctx, batchInput()),
    document: () => insertDocument(ctx, documentInput()),
    transport_leg: () => createTransportLeg(ctx, legInput()),
  }[type];
  await expect(write()).rejects.toBe(FAILURE);
  spy.mockRestore();
  expect(await allEvents()).toEqual([]);
  const table = { application: applications, credit_batch: creditBatches, document: documents, transport_leg: transportLegs }[type];
  const rows = await db.select().from(table).where(eq(table.organizationId, ctx.organizationId));
  expect(rows).toHaveLength(type === "credit_batch" ? 1 : 0);
});

it("rolls back auto-attachment and version changes with its caller", async () => {
  await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, fixture.batch.id));
  await expect(db.transaction(async tx => {
    await attachProductionRunToMatchingCreditBatch(ctx, tx, fixture.run.id);
    throw FAILURE;
  })).rejects.toBe(FAILURE);
  expect(await allEvents()).toEqual([]);
  expect(await db.select().from(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, ctx.organizationId))).toEqual([]);
  const [batch] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batch.id));
  expect(batch.version).toBe(fixture.batch.version);
  expect(await db.select().from(productionRuns).where(and(eq(productionRuns.id, fixture.run.id), eq(productionRuns.organizationId, ctx.organizationId)))).toHaveLength(1);
});

it.each(["update", "delete"] as const)("rolls back application %s and its activity after a recording failure", async action => {
  const saved = await createApplication(ctx, applicationInput());
  const before = await allEvents();
  const original = activity.recordActivity;
  vi.spyOn(activity, "recordActivity").mockImplementationOnce(async (...args) => {
    await original(...args);
    throw FAILURE;
  });
  await expect(action === "update"
    ? updateApplication(ctx, saved.id, { expectedVersion: saved.version, cropType: "uncommitted" })
    : deleteApplication(ctx, saved.id, saved.version)).rejects.toBe(FAILURE);
  expect(await allEvents()).toEqual(before);
  const [stored] = await db.select().from(applications).where(eq(applications.id, saved.id));
  expect(stored).toEqual(saved);
});

it.each(["update", "delete"] as const)("rolls back batch %s, membership and activity after a recording failure", async action => {
  const original = activity.recordActivity;
  vi.spyOn(activity, "recordActivity").mockImplementationOnce(async (...args) => {
    await original(...args);
    throw FAILURE;
  });
  await expect(action === "update"
    ? updateCreditBatch(ctx, fixture.batch.id, { expectedVersion: fixture.batch.version, productionRunIds: [] })
    : deleteCreditBatch(ctx, fixture.batch.id, fixture.batch.version)).rejects.toBe(FAILURE);
  expect(await allEvents()).toEqual([]);
  const [stored] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batch.id));
  expect(stored).toEqual(fixture.batch);
  expect(await db.select().from(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, ctx.organizationId))).toHaveLength(1);
});

it("rolls back legacy document deletion and activity on failure", async () => {
  const writer = deleteDocumentRow;
  const saved = await insertDocument(ctx, documentInput());
  const before = await allEvents();
  const original = activity.recordActivity;
  vi.spyOn(activity, "recordActivity").mockImplementationOnce(async (...args) => {
    await original(...args);
    throw FAILURE;
  });
  await expect(writer(ctx, saved.id, "form")).rejects.toBe(FAILURE);
  expect(await allEvents()).toEqual(before);
  const [stored] = await db.select().from(documents).where(eq(documents.id, saved.id));
  expect(stored).toEqual(saved);
});

it.each(["update", "delete"] as const)("rolls back transport %s and its activity after a recording failure", async action => {
  const saved = await createTransportLeg(ctx, legInput());
  const before = await allEvents();
  const original = activity.recordActivity;
  vi.spyOn(activity, "recordActivity").mockImplementationOnce(async (...args) => {
    await original(...args);
    throw FAILURE;
  });
  await expect(action === "update"
    ? updateTransportLeg(ctx, saved.id, { expectedVersion: saved.version, distanceKm: UPDATED_LEG_DISTANCE_KM })
    : deleteTransportLeg(ctx, saved.id, saved.version)).rejects.toBe(FAILURE);
  expect(await allEvents()).toEqual(before);
  const [stored] = await db.select().from(transportLegs).where(eq(transportLegs.id, saved.id));
  expect(stored).toEqual(saved);
});

it("records one batch lifecycle event when create/delete also changes initial membership", async () => {
  await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, fixture.batch.id));
  await db.delete(creditBatches).where(eq(creditBatches.id, fixture.batch.id));
  const created = await createCreditBatch(ctx, {
    ...batchInput(), startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31"), productionRunIds: [fixture.run.id],
  });
  expect((await events("credit_batch", created.id)).map(row => row.action)).toEqual(["created"]);
  expect(await events("production_run", fixture.run.id)).toMatchObject([{ reasonCode: "attached", creditBatchId: created.id }]);
  await deleteCreditBatch(ctx, created.id, created.version);
  expect((await events("credit_batch", created.id)).map(row => row.action)).toEqual(["deleted", "created"]);
  expect((await events("production_run", fixture.run.id)).map(row => row.reasonCode)).toEqual(["detached", "attached"]);
});

it("rolls back document retirement with a failed parent transaction", async () => {
  const saved = await insertDocument(ctx, documentInput());
  const before = await allEvents();
  await expect(db.transaction(async tx => {
    await retireDocumentsForEntities(ctx, tx, [{ entityType: "credit_batch", entityId: fixture.batch.id }], "form");
    throw FAILURE;
  })).rejects.toBe(FAILURE);
  expect(await allEvents()).toEqual(before);
  expect(await db.select().from(documents).where(eq(documents.id, saved.id))).toHaveLength(1);
});

it("records exactly one document event for each app upload request, confirm and delete", async () => {
  const declaration = {
    entityType: "credit_batch", entityId: fixture.batch.id, documentType: "pdf", fileName: PRIVATE_FILENAME,
    contentType: "application/pdf", sizeBytes: DOCUMENT_SIZE_BYTES, sha256: "a".repeat(SHA256_HEX_LENGTH), storageProvider: "local-fs", storageBucket: "local-fs",
  };
  const document = await runOperationInProcess(requestDocumentUploadApp, ctx, declaration);
  expect((await events("document", document.id)).map(row => row.action)).toEqual(["created"]);
  const facts = { ...uploadFactsFor(document), finalKey: `org/${ctx.organizationId}/evidence/${document.id}`,
    inspectedSha256: declaration.sha256, inspectedSizeBytes: declaration.sizeBytes, inspectedContentType: declaration.contentType };
  const confirmed = await runOperationInProcess(confirmDocumentUploadApp, ctx, facts);
  expect(confirmed).toMatchObject({ kind: "uploaded", transitioned: true });
  if (confirmed.kind !== "uploaded") throw new Error("Document confirmation failed");
  expect((await events("document", document.id)).map(row => row.action)).toEqual(["updated", "created"]);
  await runOperationInProcess(confirmDocumentUploadApp, ctx, facts);
  expect(await events("document", document.id)).toHaveLength(2);
  await runOperationInProcess(deleteDocumentApp, ctx, { documentId: document.id, expectedVersion: confirmed.document.version });
  const rows = await events("document", document.id);
  expect(rows.map(row => row.action)).toEqual(["deleted", "updated", "created"]);
  for (const row of rows) expect(row).toMatchObject({ entityType: "document", source: "form", creditBatchId: fixture.batch.id });
  const serialized = stringifyWithBigint(rows);
  for (const value of [PRIVATE_FILENAME, declaration.sha256, facts.finalKey]) expect(serialized).not.toContain(value);
});

it("records one sample deletion and one attached-document deletion through the app runner", async () => {
  const sample = await insertSample();
  const document = await insertDocument(ctx, documentInput("sample", sample.id));
  await runOperationInProcess(deleteLabSample, ctx, { labSampleId: sample.id, expectedVersion: sample.version });
  const deleted = (await allEvents()).filter(row => row.action === "deleted");
  expect(deleted).toHaveLength(2);
  expect(deleted).toEqual(expect.arrayContaining([
    expect.objectContaining({ entityType: "lab_sample", entityId: sample.id, creditBatchId: fixture.batch.id, source: "form" }),
    expect.objectContaining({ entityType: "document", entityId: document.id, creditBatchId: fixture.batch.id, source: "form" }),
  ]));
});

it("records failed-upload retention as system in the sweep transaction without duplicate expiry events", async () => {
  const document = await runOperationInProcess(requestDocumentUploadApp, ctx, {
    entityType: "credit_batch", entityId: fixture.batch.id, documentType: "pdf", fileName: PRIVATE_FILENAME,
    contentType: "application/pdf", sizeBytes: DOCUMENT_SIZE_BYTES, storageProvider: "local-fs", storageBucket: "local-fs",
  });
  const expiredAt = new Date(Date.now() - DOCUMENT_UPLOAD_GRACE_MS - RETENTION_BOUNDARY_OFFSET_MS);
  await db.update(documents).set({ uploadExpiresAt: expiredAt }).where(eq(documents.id, document.id));
  const now = new Date();
  await db.transaction(tx => expireDocumentUploadsInTransaction(tx, now, [ctx.organizationId]));
  expect((await events("document", document.id)).map(row => row.action)).toEqual(["created"]);
  await db.update(documents).set({ updatedAt: new Date(now.getTime() - DOCUMENT_FAILED_RETENTION_MS - RETENTION_BOUNDARY_OFFSET_MS) })
    .where(eq(documents.id, document.id));
  await db.transaction(tx => retireFailedDocumentUploadsInTransaction(tx, now, [ctx.organizationId]));
  await db.transaction(tx => retireFailedDocumentUploadsInTransaction(tx, now, [ctx.organizationId]));
  const rows = await events("document", document.id);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ action: "deleted", source: "system", actorUserId: null, creditBatchId: fixture.batch.id });
});

it("rolls back certification-safe app deletion and activity on recording failure", async () => {
  const saved = await insertDocument(ctx, documentInput());
  const before = await allEvents();
  const original = activity.recordActivity;
  vi.spyOn(activity, "recordActivity").mockImplementationOnce(async (...args) => {
    await original(...args);
    throw FAILURE;
  });
  await expect(runOperationInProcess(deleteDocumentApp, ctx, { documentId: saved.id, expectedVersion: saved.version }))
    .rejects.toBe(FAILURE);
  expect(await allEvents()).toEqual(before);
  const [stored] = await db.select().from(documents).where(eq(documents.id, saved.id));
  expect(stored).toEqual(saved);
});


it.each(["rest", "mcp", "script"] as const)("records derived document retirement as system when a %s update clears the leg", async source => {
  await db.transaction(async tx => {
    await tx.update(feedstocks).set({ distanceKmOverride: LEG_DISTANCE_KM, distanceSource: "manual" }).where(eq(feedstocks.id, fixture.feedstock.id));
    await syncFeedstockTransportLeg(ctx, tx, fixture.feedstock.id, { refreshFromLocation: true });
  });
  const [leg] = await db.select().from(transportLegs).where(eq(transportLegs.organizationId, ctx.organizationId));
  const document = await insertDocument(ctx, documentInput("transport_leg", leg.id));
  const input = { feedstockId: fixture.feedstock.id, expectedVersion: fixture.feedstock.version, transportDistanceKm: null };
  if (source === "script") await runOperation(updateFeedstock, ctx, input, { activitySource: source });
  else await runOperation(updateFeedstock, ctx, input, { audit: { transport: source, requestId: crypto.randomUUID(), credentialId: crypto.randomUUID() } });
  expect((await events("document", document.id))[0]).toMatchObject({
    action: "deleted", source: "system", actorUserId: ctx.userId, creditBatchId: fixture.batch.id, productionRunId: fixture.run.id,
  });
  expect(await db.select().from(transportLegs).where(eq(transportLegs.id, leg.id))).toEqual([]);
});

it("records only affected batch visibility changes on facility archive and restore", async () => {
  const [otherBatch] = await db.insert(creditBatches).values({ ...fixture.batch, id: crypto.randomUUID(), code: "ACT-CB-ARCHIVED", archivedAt: OTHER_RUN_START }).returning();
  const archived = await archiveFacility(ctx, fixture.facility.id, fixture.facility.version);
  await restoreFacility(ctx, fixture.facility.id, archived.version);
  expect(await events("credit_batch", fixture.batch.id)).toMatchObject([
    { action: "updated", source: "form", actorUserId: ctx.userId, creditBatchId: fixture.batch.id, changedFields: ["archivedAt"] },
    { action: "updated", source: "form", actorUserId: ctx.userId, creditBatchId: fixture.batch.id, changedFields: ["archivedAt"] },
  ]);
  expect(await events("credit_batch", otherBatch.id)).toEqual([]);
  const [restored] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batch.id));
  expect(restored.archivedAt).toBeNull();
  const [untouched] = await db.select().from(creditBatches).where(eq(creditBatches.id, otherBatch.id));
  expect(untouched).toEqual(otherBatch);
});

it("records vehicle snapshot refreshes as system leg updates with batch and run scope", async () => {
  const [vehicle] = await db.insert(vehicles).values({ organizationId: ctx.organizationId, code: "ACT-VEHICLE", name: "Activity vehicle", vehicleType: "truck", modelYear: INITIAL_MODEL_YEAR }).returning();
  await db.update(feedstocks).set({ vehicleId: vehicle.id }).where(eq(feedstocks.id, fixture.feedstock.id));
  await db.transaction(async tx => {
    await tx.update(feedstocks).set({ distanceKmOverride: LEG_DISTANCE_KM, distanceSource: "manual" }).where(eq(feedstocks.id, fixture.feedstock.id));
    await syncFeedstockTransportLeg(ctx, tx, fixture.feedstock.id, { refreshFromLocation: true });
  });
  const [leg] = await db.select().from(transportLegs).where(eq(transportLegs.organizationId, ctx.organizationId));
  const updated = await updateVehicle(ctx, vehicle.id, { name: vehicle.name, vehicleType: "van", modelYear: UPDATED_MODEL_YEAR }, vehicle.version);
  const rows = await events("transport_leg", leg.id);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ action: "updated", source: "system", actorUserId: ctx.userId,
    changedFields: ["vehicleType", "modelYear"], creditBatchId: fixture.batch.id, productionRunId: fixture.run.id });
  const [refreshed] = await db.select().from(transportLegs).where(eq(transportLegs.id, leg.id));
  expect(refreshed).toMatchObject({ vehicleType: "van", modelYear: UPDATED_MODEL_YEAR, version: leg.version + 1 });
  await updateVehicle(ctx, vehicle.id, { name: "Renamed vehicle", vehicleType: updated.vehicleType, modelYear: updated.modelYear }, updated.version);
  expect(await events("transport_leg", leg.id)).toHaveLength(2);
});

it("excludes fully reversed product shares from delivery and order activity scopes", async () => {
  const [nextRun] = await db.insert(productionRuns).values({ ...fixture.run, id: crypto.randomUUID(), code: "ACT-RUN-NEXT", startTime: NEXT_RUN_START, endTime: NEXT_ACTIVITY_DATE }).returning();
  const [nextBatch] = await db.insert(creditBatches).values({ ...fixture.batch, id: crypto.randomUUID(), code: "ACT-CB-NEXT", startDate: "2026-02-01", endDate: "2026-02-28" }).returning();
  await db.insert(creditBatchProductionRuns).values({ organizationId: ctx.organizationId, creditBatchId: nextBatch.id, productionRunId: nextRun.id });
  const [nextProduct] = await db.insert(biocharProducts).values({ ...fixture.product, id: crypto.randomUUID(), code: "ACT-BP-NEXT", linkedProductionRunId: nextRun.id, productionDate: formatUtcDate(NEXT_ACTIVITY_DATE), placedAt: NEXT_ACTIVITY_DATE }).returning();
  await db.insert(biocharProductSourceAllocations).values({ organizationId: ctx.organizationId, biocharProductId: nextProduct.id, productionRunId: nextRun.id,
    sourceStorageLocationId: nextRun.biocharStorageLocationId!, allocatedWetMassKg: nextRun.biocharOutputKg!, allocatedDryMassKg: nextRun.biocharDryMassKg! });
  const [original] = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, fixture.delivery.id));
  const [movement] = await db.select().from(binMovements).where(eq(binMovements.id, original.movementId));
  const [reversalMovement] = await db.insert(binMovements).values({ ...movement, id: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), outputKind: "reversal", correctsMovementId: movement.id,
    massDeltaKg: -movement.massDeltaKg!, outputDryDeltaKg: String(-Number(movement.outputDryDeltaKg)),
    balanceBeforeDryKg: movement.balanceAfterDryKg, balanceAfterDryKg: movement.balanceBeforeDryKg }).returning();
  const [reversal] = await db.insert(outputStockAllocations).values({ ...original, id: crypto.randomUUID(), movementId: reversalMovement.id, reversesAllocationId: original.id,
    dryMassKg: String(-Number(original.dryMassKg)), wetMassKg: String(-Number(original.wetMassKg)) }).returning();
  await db.insert(outputStockRunAllocations).values({ organizationId: ctx.organizationId, allocationId: reversal.id, productionRunId: fixture.run.id, dryMassKg: reversal.dryMassKg });
  const [replacementDelivery] = await insertOutputDeliveryFixture(db, { ...fixture.delivery, id: crypto.randomUUID(), code: "ACT-DL-REPLACEMENT", biocharProductId: nextProduct.id }, row => row);
  await db.update(outputStockAllocations).set({ deliveryId: fixture.delivery.id }).where(eq(outputStockAllocations.deliveryId, replacementDelivery.id));
  await db.delete(deliveries).where(eq(deliveries.id, replacementDelivery.id));
  for (const [type, id] of [["delivery", fixture.delivery.id], ["order", fixture.delivery.orderId]] as const) {
    expect(await db.transaction(tx => resolveWriteActivityScopes(ctx, tx, type, id))).toEqual([{ creditBatchId: nextBatch.id, productionRunId: nextRun.id }]);
    const document = await insertDocument(ctx, documentInput(type, id));
    expect(await events("document", document.id)).toMatchObject([{ creditBatchId: nextBatch.id, productionRunId: nextRun.id }]);
  }
});

it("excludes zero-mass application shares in another batch from activity ownership", async () => {
  const application = await createApplication(ctx, applicationInput());
  const [nextRun] = await db.insert(productionRuns).values({ ...fixture.run, id: crypto.randomUUID(), code: "ACT-RUN-ZERO", startTime: NEXT_RUN_START, endTime: NEXT_ACTIVITY_DATE }).returning();
  const [nextBatch] = await db.insert(creditBatches).values({ ...fixture.batch, id: crypto.randomUUID(), code: "ACT-CB-ZERO", startDate: "2026-02-01", endDate: "2026-02-28" }).returning();
  await db.insert(creditBatchProductionRuns).values({ organizationId: ctx.organizationId, creditBatchId: nextBatch.id, productionRunId: nextRun.id });
  await db.insert(applicationOutputAllocations).values({
    organizationId: ctx.organizationId, applicationId: application.id, deliveryId: fixture.delivery.id,
    biocharProductId: fixture.product.id, productionRunId: nextRun.id, wetMassKg: "0", dryMassKg: "0",
  });
  const document = await insertDocument(ctx, documentInput("application", application.id));
  expect(await events("document", document.id)).toMatchObject([
    { creditBatchId: fixture.batch.id, productionRunId: fixture.run.id },
  ]);
  expect(await events("document", document.id)).toHaveLength(1);
});

it("retires failed delivery uploads with no allocations and records unscoped activity", async () => {
  const [delivery] = await db.insert(deliveries).values({ ...fixture.delivery, id: crypto.randomUUID(), code: "ACT-DL-NO-ALLOCATIONS" }).returning();
  const document = await runOperationInProcess(requestDocumentUploadApp, ctx, {
    entityType: "delivery", entityId: delivery.id, documentType: "pdf", fileName: PRIVATE_FILENAME,
    contentType: "application/pdf", sizeBytes: DOCUMENT_SIZE_BYTES, storageProvider: "local-fs", storageBucket: "local-fs",
  });
  const now = new Date();
  await db.update(documents).set({ uploadExpiresAt: new Date(now.getTime() - DOCUMENT_UPLOAD_GRACE_MS - RETENTION_BOUNDARY_OFFSET_MS) })
    .where(eq(documents.id, document.id));
  await db.transaction(tx => expireDocumentUploadsInTransaction(tx, now, [ctx.organizationId]));
  await db.update(documents).set({ updatedAt: new Date(now.getTime() - DOCUMENT_FAILED_RETENTION_MS - RETENTION_BOUNDARY_OFFSET_MS) })
    .where(eq(documents.id, document.id));
  expect(await db.transaction(tx => retireFailedDocumentUploadsInTransaction(tx, now, [ctx.organizationId]))).toBe(1);
  expect(await db.select().from(documents).where(eq(documents.id, document.id))).toEqual([]);
  expect((await events("document", document.id)).filter(row => row.action === "deleted")).toMatchObject([
    { source: "system", actorUserId: null, creditBatchId: null, productionRunId: null },
  ]);
});
