import { apiActivityWhere } from "./helpers/api-activity";
import * as siteDefaults from "@/data-access/application-site-defaults";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db } from "@/db";
import { applications, users, customerLocations, certifierProjects, facilities, outputStockAllocations, activityEvents, apiIdempotencyRecords, organizations, documents, storageObjectDeletions } from "@/db/schema";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import { PRO_RATA_POLICY } from "@/lib/output-stock";
import { TEST_GIS_BOUNDARY } from "./helpers/application-evidence-fixtures";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { recordApplication, updateApplication, deleteApplication } from "@/lib/operations/applications";
import { createMutationFixture, cleanupMutationFixture } from "./helpers/application-write-fixture";
import { makeTestOrgContext } from "./helpers/test-org";

vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
const storage = vi.hoisted(() => ({ drain: vi.fn(async () => undefined) }));
vi.mock("@/data-access/storage-object-deletions", async original => ({ ...await original<object>(), processPendingStorageObjectDeletions: storage.drain }));
const tag = randomUUID();
const ctx = { ...makeTestOrgContext(`operation-applications-${tag}`), organizationId: `operation-applications-${tag}` };
const pool = db.$client;
const options = { pool };
beforeAll(async () => {
  await db.insert(organizations).values({ id: ctx.organizationId, name: "Operation applications", slug: ctx.organizationId });
  await db.insert(users).values({ id: ctx.userId, email: `operation-applications-${tag}@example.test` }).onConflictDoNothing();
});
afterAll(async () => {
  await db.delete(activityEvents).where(eq(activityEvents.organizationId, ctx.organizationId));
  await db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, ctx.organizationId));
  await db.delete(storageObjectDeletions).where(eq(storageObjectDeletions.organizationId, ctx.organizationId));
  await db.delete(organizations).where(eq(organizations.id, ctx.organizationId));
  await db.delete(users).where(eq(users.id, ctx.userId));
  await pool.end();
});
const input = (deliveryId: string) => ({ deliveryId, appliedWetMassKg: 1000, applicationDate: "2025-07-08", fieldSizeHa: 1, gpsLatitude: 0, gpsLongitude: 0, soilTemperatureC: null });
async function fixtureTest(work: (f: Awaited<ReturnType<typeof createMutationFixture>>) => Promise<void>) {
  const f = await createMutationFixture(randomUUID(), ctx.organizationId);
  try { await work(f); } finally {
    f.applicationIds = (await db.select({ id: applications.id }).from(applications).where(inArray(applications.deliveryId, f.deliveryIds))).map(row => row.id);
    if (f.applicationIds.length) await db.delete(documents).where(inArray(documents.entityId, f.applicationIds));
    await cleanupMutationFixture(f);
  }
}

it("returns JSON safe frozen allocations and the locked delivery balance on both runner paths", () => fixtureTest(async f => {
  expect(db.$client.options.max).toBe(1);
  const saved = await runOperation(recordApplication, ctx, input(f.deliveryIds[0]), options);
  expect(saved.data.application).toMatchObject({ biocharAppliedTons: 1, biocharAppliedDryTons: 0.8 });
  expect(saved.data.allocations).toEqual([expect.objectContaining({ biocharProductId: f.productId, wetMassKg: 1000, dryBiocharKg: 800, productCode: expect.any(String), productionRunId: expect.any(String), productionRunCode: expect.any(String) })]);
  expect(saved.data.deliveryBalance).toEqual({ remainingWetMassKgBefore: 5000, remainingWetMassKgAfter: 4000 });
  expect(() => JSON.stringify(saved)).not.toThrow();
  const native = await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0]), options);
  expect(native.application.applicationDate).toBeInstanceOf(Date);
  expect(native.deliveryBalance).toEqual({ remainingWetMassKgBefore: 4000, remainingWetMassKgAfter: 3000 });
}));

it("copies omitted site defaults and previews the same facts without claiming a key", () => fixtureTest(async f => {
  await db.update(facilities).set({ durabilityOption: "200_year" }).where(eq(facilities.id, f.facilityId));
  const body = { ...input(f.deliveryIds[0]), gpsLatitude: undefined, gpsLongitude: undefined, soilTemperatureC: undefined };
  const keyed = { ...options, idempotency: { credentialId: randomUUID(), key: randomUUID() } };
  const preview = await runOperation(recordApplication, ctx, body, { ...keyed, dryRun: true });
  expect(await db.select().from(applications).where(eq(applications.deliveryId, f.deliveryIds[0]))).toEqual([]);
  const committed = await runOperation(recordApplication, ctx, body, keyed);
  const stableFields = (row: object) => Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "createdAt", "updatedAt"].includes(key)));
  const previewFields = stableFields(preview.data.application);
  const fields = stableFields(committed.data.application);
  expect(previewFields).toEqual(fields);
  expect(preview.data.allocations).toEqual(committed.data.allocations);
  expect(preview.data.deliveryBalance).toEqual(committed.data.deliveryBalance);
  expect(preview.data.warnings).toEqual(committed.data.warnings);
  expect(fields).toMatchObject({ gpsLatitude: -3.3, gpsLongitude: 37.3, soilTemperatureSource: "global_database" });
  expect(fields.soilTemperatureC).toBeCloseTo(21.4);
  expect(committed.data.warnings).toEqual([expect.stringMatching(/^GPS copied from customer location /), expect.stringMatching(/^Soil temperature copied from customer location /)]);
  await expect(runOperation(recordApplication, ctx, body, { ...keyed, dryRun: true })).rejects.toMatchObject({ code: "key_already_used" });
  const replay = await runOperation(recordApplication, ctx, Object.fromEntries(Object.entries(body).reverse()), keyed);
  expect(replay.replayed).toBe(true);
  expect(replay.data).toEqual(committed.data);
  await expect(runOperation(recordApplication, ctx, { ...body, fieldSizeHa: 2 }, keyed)).rejects.toMatchObject({ code: "idempotency_key_reused" });
}));

it("returns changed shares and target balances for mass changes and repoints, preserving shares for metadata", () => fixtureTest(async f => {
  const first = (await runOperation(recordApplication, ctx, input(f.deliveryIds[0]), options)).data;
  const patch = (expectedVersion: number, changes: object) => runOperation(updateApplication, ctx, { applicationId: first.application.id, expectedVersion, ...changes }, options);
  const metadata = (await patch(1, { cropType: "Maize" })).data;
  expect(metadata.allocations).toEqual(first.allocations);
  expect(metadata.deliveryBalance).toEqual({ remainingWetMassKgBefore: 4000, remainingWetMassKgAfter: 4000 });
  const changed = (await patch(2, { appliedWetMassKg: 1500 })).data;
  expect(changed.allocations).toEqual([expect.objectContaining({ wetMassKg: 1500, dryBiocharKg: 1200 })]);
  expect(changed.deliveryBalance).toEqual({ remainingWetMassKgBefore: 4000, remainingWetMassKgAfter: 3500 });
  const moved = (await patch(3, { deliveryId: f.deliveryIds[1] })).data;
  expect(moved.allocations).toEqual([expect.objectContaining({ wetMassKg: 1500, dryBiocharKg: 1350 })]);
  expect(moved.deliveryBalance).toEqual({ remainingWetMassKgBefore: 3000, remainingWetMassKgAfter: 1500 });
}));

it("rolls back delete without draining, then drains after the committed row disappears", () => fixtureTest(async f => {
  const { application } = await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0]), options);
  const storageKey = `test/application/${randomUUID()}`;
  await db.insert(documents).values({ organizationId: ctx.organizationId, entityType: "application", entityId: application.id,
    documentType: "photo", fileName: "evidence.jpg", storageProvider: "local-fs", storageBucket: "local-fs", storageKey, createdBy: ctx.userId });
  const queued = () => db.select().from(storageObjectDeletions).where(eq(storageObjectDeletions.storageKey, storageKey));
  const command = { applicationId: application.id, expectedVersion: 1 };
  storage.drain.mockClear();
  await runOperation(deleteApplication, ctx, command, { ...options, dryRun: true });
  expect(storage.drain).not.toHaveBeenCalled();
  expect(await queued()).toEqual([]);
  expect(await db.select().from(applications).where(eq(applications.id, application.id))).toHaveLength(1);
  storage.drain.mockImplementationOnce(async () => {
    expect(await db.select().from(applications).where(eq(applications.id, application.id))).toEqual([]);
    expect(await queued()).toHaveLength(1);
  });
  await runOperation(deleteApplication, ctx, command, options);
  expect(storage.drain).toHaveBeenCalledTimes(1);
}));

it("preserves explicit null, refuses absent site GPS, and never fills omitted PATCH GPS", () => fixtureTest(async f => {
  await expect(runOperation(recordApplication, ctx, { ...input(f.deliveryIds[0]), gpsLatitude: null, gpsLongitude: null }, options))
    .rejects.toMatchObject({ code: "validation_failed", issues: [expect.objectContaining({ path: ["gpsLatitude"] })] });
  // Current sites require GPS in the DB. Exercise the unavailable-site fallback at the read boundary.
  const unavailable = vi.spyOn(siteDefaults, "getApplicationSiteDefaults").mockResolvedValueOnce(null);
  await expect(runOperation(recordApplication, ctx, { ...input(f.deliveryIds[0]), gpsLatitude: undefined, gpsLongitude: undefined }, options))
    .rejects.toMatchObject({ code: "validation_failed", issues: [expect.objectContaining({ path: ["gpsLatitude"] })] });
  unavailable.mockRestore();
  const { application } = await runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0]), evidenceMethod: "boundary", gisBoundary: TEST_GIS_BOUNDARY, gpsLatitude: null, gpsLongitude: null }, options);
  const saved = await runOperationInProcess(updateApplication, ctx, { applicationId: application.id, expectedVersion: 1, cropType: "Maize" }, options);
  expect(saved.application).toMatchObject({ gpsLatitude: null, gpsLongitude: null, soilTemperatureC: null });
  await expect(runOperation(updateApplication, ctx, { applicationId: application.id, expectedVersion: 2, evidenceMethod: "location" }, options))
    .rejects.toMatchObject({ code: "validation_failed", issues: [expect.objectContaining({ path: ["gpsLatitude"] })] });
}));

it("leaves omitted GPS unfilled without a GPS warning for boundary evidence", () => fixtureTest(async f => {
  const saved = await runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0]), evidenceMethod: "boundary", gisBoundary: TEST_GIS_BOUNDARY, gpsLatitude: undefined, gpsLongitude: undefined }, options);
  expect(saved.application).toMatchObject({ gpsLatitude: null, gpsLongitude: null });
  expect(saved.warnings.some(warning => warning.startsWith("GPS copied"))).toBe(false);
}));

it.each(["baseline", null] as const)("preserves an explicit soil source %s without a temperature", soilTemperatureSource => fixtureTest(async f => {
  await db.update(facilities).set({ durabilityOption: "200_year" }).where(eq(facilities.id, f.facilityId));
  const saved = await runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0]), soilTemperatureC: undefined, soilTemperatureSource }, options);
  expect(saved.application).toMatchObject({ soilTemperatureC: null, soilTemperatureSource });
  expect(saved.warnings.some(warning => warning.startsWith("Soil temperature copied"))).toBe(false);
}));

it("leaves soil defaults unfilled without warnings at a 1000-year facility", () => fixtureTest(async f => {
  await db.update(facilities).set({ durabilityOption: "1000_year" }).where(eq(facilities.id, f.facilityId));
  const saved = await runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0]), soilTemperatureC: undefined }, options);
  expect(saved.application).toMatchObject({ soilTemperatureC: null, soilTemperatureSource: null });
  expect(saved.warnings).toEqual([]);
}));

it("falls back to the facility soil default and leaves an explicit null unfilled", () => fixtureTest(async f => {
  await db.update(facilities).set({ durabilityOption: "200_year" }).where(eq(facilities.id, f.facilityId));
  await db.update(customerLocations).set({ defaultSoilTemperatureC: null }).where(eq(customerLocations.id, f.customerLocationId));
  const saved = await runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0]), soilTemperatureC: undefined }, options);
  expect(saved.application.soilTemperatureC).toBeCloseTo(24.8);
  expect(saved.application.soilTemperatureSource).toBe("global_database");
  expect(saved.warnings).toContain("Soil temperature copied from the facility default.");
  const cleared = await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0]), options);
  expect(cleared.application.soilTemperatureC).toBeNull();
  expect(cleared.warnings.some(warning => warning.startsWith("Soil temperature copied"))).toBe(false);
}));

it("returns the facility reference advisory on create and PATCH without a soil temperature", () => fixtureTest(async f => {
  await db.update(facilities).set({ durabilityOption: "200_year" }).where(eq(facilities.id, f.facilityId));
  await db.update(customerLocations).set({ defaultSoilTemperatureC: null }).where(eq(customerLocations.id, f.customerLocationId));
  await db.update(certifierProjects).set({ defaultSoilTemperatureC: null }).where(eq(certifierProjects.facilityId, f.facilityId));
  const saved = await runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0]), soilTemperatureC: undefined }, options);
  expect(saved.warnings).toEqual(["Submission uses the facility reference temperature."]);
  const updated = await runOperationInProcess(updateApplication, ctx, { applicationId: saved.application.id, expectedVersion: 1, cropType: "Maize" }, options);
  expect(updated.warnings).toEqual(saved.warnings);
}));

it("returns the existing mix bin hold notice on create and PATCH", () => fixtureTest(async f => {
  const draws = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, f.deliveryIds[0]));
  expect(draws.length).toBeGreaterThan(0);
  for (const draw of draws) await db.update(outputStockAllocations).set({ basisSnapshot: { ...draw.basisSnapshot, policy: PRO_RATA_POLICY } }).where(eq(outputStockAllocations.id, draw.id));
  const saved = await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0]), options);
  const notice = "Not in a credit batch: this biochar was drawn from a mix bin. Mix-bin biochar is held out of credit batches until the project design document (PDD) covers mixing.";
  expect(saved.warnings).toContain(notice);
  const updated = await runOperationInProcess(updateApplication, ctx, { applicationId: saved.application.id, expectedVersion: 1, cropType: "Maize" }, options);
  expect(updated.warnings).toContain(notice);
}));

it("parallel duplicate keys give one application, one outcome and one audit event with separate pools", () => fixtureTest(async f => {
  const otherPool = new Pool({ ...getPgPoolConfig(process.env.DATABASE_URL!), max: 1 });
  vi.resetModules();
  const otherRunner = await import("@/lib/operations/runner");
  const credentialId = randomUUID();
  const keyed = { ...options, idempotency: { credentialId, key: randomUUID() }, audit: { credentialId, transport: "rest" as const, requestId: randomUUID() } };
  const replayAudit = { ...keyed.audit, requestId: randomUUID() };
  try {
    const results = await Promise.allSettled([
      runOperation(recordApplication, ctx, input(f.deliveryIds[0]), keyed),
      otherRunner.runOperation(recordApplication, ctx, input(f.deliveryIds[0]), { ...keyed, audit: replayAudit, pool: otherPool }),
    ]);
    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    const responses = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    expect(responses.filter(result => result.replayed)).toHaveLength(1);
    expect(responses[0].data).toEqual(responses[1].data);
    expect(await db.select().from(applications).where(eq(applications.deliveryId, f.deliveryIds[0]))).toHaveLength(1);
    const events = await db.select().from(activityEvents).where(apiActivityWhere(ctx.organizationId, eq(activityEvents.credentialId, credentialId)));
    expect(new Set(events.map(event => event.requestId)).size).toBe(1);
    const committedRequestId = responses[0].replayed ? replayAudit.requestId : keyed.audit.requestId;
    const committedRows = events.filter(event => event.requestId === committedRequestId);
    expect(committedRows.length).toBeGreaterThan(0);
    expect(events).toHaveLength(committedRows.length);
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.credentialId, credentialId))).toHaveLength(1);
  } finally {
    await otherPool.end();
    await db.delete(activityEvents).where(eq(activityEvents.credentialId, credentialId));
    await db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.credentialId, credentialId));
  }
}));

it("previews and replays PATCH and DELETE after their original versions disappear", () => fixtureTest(async f => {
  const saved = await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0]), options);
  const command = { applicationId: saved.application.id, expectedVersion: 1, appliedWetMassKg: 1200 };
  const keyed = { ...options, idempotency: { credentialId: randomUUID(), key: randomUUID(), target: saved.application.id, precondition: "1" } };
  const preview = await runOperation(updateApplication, ctx, command, { ...keyed, dryRun: true });
  const [unchanged] = await db.select().from(applications).where(eq(applications.id, saved.application.id));
  expect(unchanged).toMatchObject({ version: 1, biocharAppliedTons: 1 });
  const committed = await runOperation(updateApplication, ctx, command, keyed);
  expect(preview.data.allocations).toEqual(committed.data.allocations);
  expect(preview.data.deliveryBalance).toEqual(committed.data.deliveryBalance);
  expect(preview.data.warnings).toEqual(committed.data.warnings);
  expect((await runOperation(updateApplication, ctx, command, keyed)).data).toEqual(committed.data);
  const deleteKey = { ...options, idempotency: { ...keyed.idempotency, key: randomUUID(), precondition: "2" } };
  const remove = { applicationId: saved.application.id, expectedVersion: 2 };
  await runOperation(deleteApplication, ctx, remove, deleteKey);
  const replay = await runOperation(deleteApplication, ctx, remove, deleteKey);
  expect(replay.replayed).toBe(true);
  expect(replay.data).toBeNull();
}));
