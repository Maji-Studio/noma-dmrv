import * as writers from "@/data-access/application-writes";
import { PRO_RATA_POLICY } from "@/lib/output-stock";
import { getMixBinHeldApplicationIds } from "@/data-access/mix-bin-credit-hold";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { applications, applicationOutputAllocations, creditBatchApplications, deliveries, documents, facilities, users, outputStockAllocations, soilTemperatureMeasurements } from "@/db/schema";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { recordApplication, updateApplication, deleteApplication } from "@/lib/operations/applications";
import { createMutationFixture, cleanupMutationFixture } from "./helpers/application-write-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { TEST_GIS_BOUNDARY } from "./helpers/application-evidence-fixtures";
import { createLineageFixture, cleanupLineageFixture } from "./helpers/certification-lineage-fixture";

const storage = vi.hoisted(() => ({ drain: vi.fn(async () => undefined) }));
vi.mock("@/data-access/storage-object-deletions", async importOriginal => ({ ...await importOriginal<object>(), processPendingStorageObjectDeletions: storage.drain }));
const ctx = makeTestOrgContext("application-write-tests");
const singlePool = new Pool({ ...getPgPoolConfig(process.env.DATABASE_URL!), max: 1 });
const options = { pool: singlePool };
beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({ id: ctx.userId, email: "application-write-tests@example.test" }).onConflictDoNothing();
});
afterAll(() => singlePool.end());
const input = (deliveryId: string, appliedWetMassKg = 4001) => ({ deliveryId, appliedWetMassKg, applicationDate: "2025-07-08", fieldSizeHa: 1, gpsLatitude: 0, gpsLongitude: 0 });
async function fixtureTest(work: (f: Awaited<ReturnType<typeof createMutationFixture>>) => Promise<void>) {
  const f = await createMutationFixture(randomUUID());
  try { await work(f); } finally {
    const rows = await db.select({ id: applications.id }).from(applications).where(eq(applications.deliveryId, f.deliveryIds[0]));
    const others = await db.select({ id: applications.id }).from(applications).where(eq(applications.deliveryId, f.deliveryIds[1]));
    f.applicationIds = [...rows, ...others].map(row => row.id);
    await cleanupMutationFixture(f);
  }
}
async function withoutGlobalDb<T>(work: () => Promise<T>): Promise<T> {
  const refuse = () => { throw new Error("Writer used the global pool"); };
  const spies = (["select", "insert", "update", "delete", "execute", "transaction"] as const)
    .map(method => vi.spyOn(db, method).mockImplementation(refuse));
  const query = Object.getOwnPropertyDescriptor(db, "query")!;
  Object.defineProperty(db, "query", { configurable: true, get: refuse });
  const querySpy = vi.spyOn(db, "query", "get");
  try { return await work(); }
  finally {
    querySpy.mockRestore();
    Object.defineProperty(db, "query", query);
    for (const spy of spies) spy.mockRestore();
  }
}
it("updates a code and retires a document without using the global pool", () => fixtureTest(async f => {
  const app = (await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0]), options)).application;
  const { application: saved } = await withoutGlobalDb(() => runOperationInProcess(updateApplication, ctx, {
    applicationId: app.id, expectedVersion: app.version, code: `AP-GUARD-${randomUUID().toUpperCase()}`,
  }, options));
  expect(saved.code).not.toBe(app.code);
  const [doc] = await db.insert(documents).values({ organizationId: ctx.organizationId, entityType: "application", entityId: app.id, documentType: "photo", fileName: "evidence.jpg", fileUrl: "https://example.test/evidence", createdBy: ctx.userId }).returning();
  await withoutGlobalDb(() => runOperationInProcess(deleteApplication, ctx, { applicationId: app.id, expectedVersion: saved.version }, options));
  expect(await db.select().from(documents).where(eq(documents.id, doc.id))).toHaveLength(0);
}));
it("uses one connection, converts 4001 kg once, and preserves exact wet/dry shares and remaining grams", () => fixtureTest(async f => {
  const { application: first } = await withoutGlobalDb(() => runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0]), options));
  expect(first).toMatchObject({ biocharAppliedTons: 4.001, biocharAppliedDryTons: 3.2008 });
  const shares = await db.select().from(applicationOutputAllocations).where(eq(applicationOutputAllocations.applicationId, first.id));
  expect(shares.reduce((n, row) => n + Math.round(Number(row.wetMassKg) * 1000), 0)).toBe(4001000);
  expect(shares.reduce((n, row) => n + Math.round(Number(row.dryMassKg) * 1000), 0)).toBe(3200800);
  await expect(runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0], 999.001), options)).rejects.toMatchObject({ code: "conflict", issues: [{ path: ["appliedWetMassKg"], meta: { measure: "delivery_remaining_wet", availableWetKg: 999, requestedWetKg: 999.001, unit: "kg" } }] });
  const last = (await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0], 999), options)).application;
  expect(last.biocharAppliedDryTons).toBe(0.7992);
}));
it("repoints shares and preserves omitted fields while null clears optional fields", () => fixtureTest(async f => {
  const first = (await runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0], 1000), cropType: "Maize", fieldIdentifier: "Field A" }, options)).application;
  const moved = (await runOperationInProcess(updateApplication, ctx, { applicationId: first.id, expectedVersion: first.version, deliveryId: f.deliveryIds[1], cropType: null }, options)).application;
  expect(moved).toMatchObject({ fieldIdentifier: "Field A", cropType: null, biocharAppliedDryTons: 0.9 });
  const shares = await db.select().from(applicationOutputAllocations).where(eq(applicationOutputAllocations.applicationId, first.id));
  expect(shares.length).toBeGreaterThan(0);
  expect(shares.every(row => row.deliveryId === f.deliveryIds[1])).toBe(true);
  const originalRemaining = (await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0], 5000), options)).application;
  expect(originalRemaining.biocharAppliedTons).toBe(5);
}));
it("refuses visual, missing boundary on create and merged PATCH, and incomplete merged GPS", () => fixtureTest(async f => {
  await expect(runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0]), evidenceMethod: "visual" }, options)).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["evidenceMethod"] }] });
  await expect(runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0]), evidenceMethod: "boundary" }, options)).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["gisBoundary"] }] });
  const app = (await runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0]), evidenceMethod: "boundary", gisBoundary: TEST_GIS_BOUNDARY }, options)).application;
  await expect(runOperationInProcess(updateApplication, ctx, { applicationId: app.id, expectedVersion: 1, gisBoundary: null }, options)).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["gisBoundary"] }] });
  await expect(runOperationInProcess(updateApplication, ctx, { applicationId: app.id, expectedVersion: 1, gpsLatitude: null }, options)).rejects.toMatchObject({ code: "validation_failed" });
}));
it.each(["delivery", "facility"] as const)("refuses create and metadata PATCH on archived %s, but permits delete", kind => fixtureTest(async f => {
  const app = (await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0]), options)).application;
  if (kind === "delivery") await db.update(deliveries).set({ archivedAt: new Date() }).where(eq(deliveries.id, f.deliveryIds[0]));
  else await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, f.facilityId));
  for (const request of [runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0], 1), options), runOperationInProcess(updateApplication, ctx, { applicationId: app.id, expectedVersion: 1, cropType: "Maize" }, options)]) await expect(request).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["deliveryId"] }] });
  await runOperationInProcess(deleteApplication, ctx, { applicationId: app.id, expectedVersion: 1 }, options);
}));
it("hides foreign deliveries without side effects and reports duplicate codes at /code", () => fixtureTest(async f => {
  await expect(runOperationInProcess(recordApplication, { ...ctx, organizationId: "foreign-org" }, input(f.deliveryIds[0]), options)).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["deliveryId"] }] });
  expect(await db.select().from(applications).where(eq(applications.deliveryId, f.deliveryIds[0]))).toHaveLength(0);
  const first = (await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0], 1), options)).application;
  const second = (await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0], 1), options)).application;
  await expect(runOperationInProcess(updateApplication, ctx, { applicationId: second.id, expectedVersion: 1, code: first.code }, options)).rejects.toMatchObject({ code: "conflict", issues: [{ path: ["code"] }] });
}));
it.each(["America/Los_Angeles", "Asia/Tokyo"])("uses delivery and today calendar days in %s", zone => fixtureTest(async f => {
  const now = new Date(zone === "Asia/Tokyo" ? "2025-07-08T20:00:00Z" : "2025-07-08T01:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  try {
    await db.update(facilities).set({ timezone: zone }).where(eq(facilities.id, f.facilityId));
    await db.update(deliveries).set({ deliveryDate: now }).where(eq(deliveries.id, f.deliveryIds[0]));
    const day = zone === "Asia/Tokyo" ? "2025-07-09" : "2025-07-07";
    const app = (await runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0], 1), applicationDate: day }, options)).application;
    expect(app.applicationDate.toISOString()).toBe(`${day}T00:00:00.000Z`);
    for (const applicationDate of (zone === "Asia/Tokyo" ? ["2025-07-08", "2025-07-10"] : ["2025-07-06", "2025-07-08"])) await expect(runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryIds[0], 1), applicationDate }, options)).rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["applicationDate"] }] });
  } finally { vi.useRealTimers(); }
}));
it("retires documents, shares and slices atomically and drains only after a real delete", async () => {
  const f = await createLineageFixture("none");
  try {
  await db.update(creditBatchApplications).set({ removalId: null }).where(eq(creditBatchApplications.applicationId, f.applicationId));
  const [app] = await db.select().from(applications).where(eq(applications.id, f.applicationId));
  expect(await db.select().from(creditBatchApplications).where(eq(creditBatchApplications.applicationId, app.id))).toMatchObject([{ removalId: null }]);
  expect((await db.select().from(applicationOutputAllocations).where(eq(applicationOutputAllocations.applicationId, app.id))).length).toBeGreaterThan(0);
  await db.insert(soilTemperatureMeasurements).values({ organizationId: ctx.organizationId, applicationId: app.id, measurementDate: "2026-06-16", temperatureC: 20 });
  const [doc] = await db.insert(documents).values({ organizationId: ctx.organizationId, entityType: "application", entityId: app.id, documentType: "photo", fileName: "evidence.jpg", fileUrl: "https://example.test/evidence", createdBy: ctx.userId }).returning();
  storage.drain.mockClear();
  const command = { applicationId: app.id, expectedVersion: 1 };
  await runOperation(deleteApplication, ctx, command, { ...options, dryRun: true });
  expect(storage.drain).not.toHaveBeenCalled();
  expect(await db.select().from(documents).where(eq(documents.id, doc.id))).toHaveLength(1);
  storage.drain.mockImplementationOnce(async () => { expect(await db.select().from(applications).where(eq(applications.id, app.id))).toHaveLength(0); });
  await runOperationInProcess(deleteApplication, ctx, command, options);
  expect(storage.drain).toHaveBeenCalledTimes(1);
  expect(await db.select().from(documents).where(eq(documents.id, doc.id))).toHaveLength(0);
  expect(await db.select().from(applicationOutputAllocations).where(eq(applicationOutputAllocations.applicationId, app.id))).toHaveLength(0);
  expect(await db.select().from(creditBatchApplications).where(eq(creditBatchApplications.applicationId, app.id))).toHaveLength(0);
  expect(await db.select().from(soilTemperatureMeasurements).where(eq(soilTemperatureMeasurements.applicationId, app.id))).toHaveLength(0);
  } finally { await cleanupLineageFixture(f); }
});
it("allows metadata under a draft Removal and refuses a mass change", async () => {
  const f = await createLineageFixture("none");
  try {
    const [app] = await db.select().from(applications).where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.id, f.applicationId)));
    const saved = (await runOperationInProcess(updateApplication, ctx, { applicationId: app.id, expectedVersion: app.version, cropType: "Maize" }, options)).application;
    expect(saved.cropType).toBe("Maize");
    await expect(runOperationInProcess(updateApplication, ctx, { applicationId: app.id, expectedVersion: saved.version, appliedWetMassKg: 1 }, options)).rejects.toMatchObject({ code: "certification_locked" });
  } finally { await cleanupLineageFixture(f); }
});
describe.todo("membership races move to artifacts before runs in commit 1b");

it("recovers a forced auto-code collision inside its savepoint", () => fixtureTest(async f => {
  const existing = (await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0], 1), options)).application;
  const original = writers.createApplicationInTransaction;
  const insert = vi.spyOn(writers, "createApplicationInTransaction");
  insert.mockImplementationOnce((context, tx, data) => original(context, tx, { ...data, code: existing.code }));
  try {
    const saved = (await runOperationInProcess(recordApplication, ctx, input(f.deliveryIds[0], 2), options)).application;
    expect(saved.code).not.toBe(existing.code);
    expect(insert).toHaveBeenCalledTimes(2);
    const apps = await db.select().from(applications).where(eq(applications.deliveryId, f.deliveryIds[0]));
    expect(apps).toHaveLength(2);
    const shares = await db.select().from(applicationOutputAllocations).where(eq(applicationOutputAllocations.applicationId, saved.id));
    expect(shares.reduce((n, share) => n + Number(share.wetMassKg), 0)).toBe(2);
  } finally { insert.mockRestore(); }
}));
it("holds mix-bin delivery applications out of unowned credit slices", async () => {
  const f = await createLineageFixture("none"); let applicationId: string | undefined;
  try {
    // Fixture an already-saved pro-rata draw. Reconciliation must honor its
    // frozen policy even if the bin's current mode later changes.
    const allocations = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, f.deliveryId));
    for (const row of allocations) await db.update(outputStockAllocations).set({ basisSnapshot: { ...row.basisSnapshot, policy: PRO_RATA_POLICY } }).where(eq(outputStockAllocations.id, row.id));
    const app = (await runOperationInProcess(recordApplication, ctx, { ...input(f.deliveryId, 1), applicationDate: "2026-06-16" }, options)).application;
    applicationId = app.id;
    expect(await getMixBinHeldApplicationIds(ctx, db, [app.id])).toEqual(new Set([app.id]));
    expect(await db.select().from(creditBatchApplications).where(eq(creditBatchApplications.applicationId, app.id))).toHaveLength(0);
  } finally {
    if (applicationId) {
      await db.delete(applicationOutputAllocations).where(eq(applicationOutputAllocations.applicationId, applicationId));
      await db.delete(applications).where(eq(applications.id, applicationId));
    }
    await cleanupLineageFixture(f);
  }
});
