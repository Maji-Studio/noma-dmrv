import { toActionFailure } from "@/fn/action-errors";
import { actionFailureResponse } from "@/lib/api/problem";
import { DomainError } from "@/lib/domain-errors";
import { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db, type DbTransaction } from "@/db";
import * as schema from "@/db/schema";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import { runOperationInProcess, type Operation } from "@/lib/operations/runner";
import { recordApplication, updateApplication, deleteApplication } from "@/lib/operations/applications";
import { requestDocumentUploadApp } from "@/lib/operations/documents";
import { updatePostedDelivery } from "@/lib/operations/deliveries";
import { archiveFacility } from "@/data-access/facilities";
import { createRemovalWithCreditBatches } from "@/data-access/certifier-removals";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { createLineageFixture, cleanupLineageFixture } from "./helpers/certification-lineage-fixture";
import { postedStockFixture, postDelivery, cleanupPostedStock, STOCK_DATE, STOCK_TIME } from "./helpers/posted-output-stock-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";
import type { z } from "zod";

const pauses = vi.hoisted(() => ({ afterArtifacts: undefined as undefined | ((tx: DbTransaction) => Promise<void>) }));
vi.mock("@/data-access/certification-lineage-guards", async importOriginal => {
  const original = await importOriginal<typeof import("@/data-access/certification-lineage-guards")>();
  return { ...original, lockCertifiedLineageArtifacts: async (...args: Parameters<typeof original.lockCertifiedLineageArtifacts>) => {
    const keys = await original.lockCertifiedLineageArtifacts(...args);
    const pause = pauses.afterArtifacts; pauses.afterArtifacts = undefined;
    if (pause) await pause(args[1]);
    return keys;
  } };
});
const pool = new Pool({ ...getPgPoolConfig(process.env.DATABASE_URL!), max: 5 });
const database = drizzle(pool, { schema });
const options = { pool };
const ctx = makeTestOrgContext("application-lock-tests");
const TEST_TIMEOUT_MS = 15000;
beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(schema.users).values({ id: ctx.userId, email: "application-lock-tests@example.test" }).onConflictDoNothing();
});
afterAll(() => pool.end());
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function outcome(promise: Promise<unknown>) { return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function pid(tx: DbTransaction) { return (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid; }
function holdAfterWrite<I extends z.ZodType, O>(operation: Operation<I, O>, ready: ReturnType<typeof gate>, resume: ReturnType<typeof gate>, state: { pid: number }): Operation<I, O> {
  return { ...operation, execute: async (scope, input) => {
    const result = await operation.execute(scope, input); state.pid = await pid(scope.tx); ready.release(); await resume.promise; return result;
  } };
}
function appInput(deliveryId: string, appliedWetMassKg: number) { return { deliveryId, appliedWetMassKg, applicationDate: STOCK_DATE, fieldSizeHa: 1, gpsLatitude: 0, gpsLongitude: 0 }; }

it.each(["update", "delete"] as const)("document upload against application %s in both artifact-lock interleavings", async mutation => {
  for (const first of ["document", "application"]) {
    const f = await createLineageFixture("none");
    const ready = gate(); const resume = gate(); let blockerPid = 0;
    const docs: string[] = [];
    const [app] = await db.select().from(schema.applications).where(eq(schema.applications.id, f.applicationId));
    pauses.afterArtifacts = async tx => { blockerPid = await pid(tx); ready.release(); await resume.promise; };
    const document = () => runOperationInProcess(requestDocumentUploadApp, ctx, { entityType: "application", entityId: f.applicationId, documentType: "photo", fileName: "evidence.jpg", contentType: "image/jpeg", sizeBytes: 8, storageProvider: "local-fs", storageBucket: "test" }, options).then(row => { docs.push(row.id); return row; });
    const application = () => mutation === "update"
      ? runOperationInProcess(updateApplication, ctx, { applicationId: app.id, expectedVersion: app.version, cropType: "Maize" }, options)
      : runOperationInProcess(deleteApplication, ctx, { applicationId: app.id, expectedVersion: app.version }, options);
    const winner = outcome(first === "document" ? document() : application());
    await ready.promise;
    const waiter = outcome(first === "document" ? application() : document());
    try { await waitForBlockedOperations(pool, blockerPid, 1); } finally { resume.release(); }
    try {
      const results = await Promise.all([winner, waiter]);
      expect(results.filter(result => result.ok)).toHaveLength(mutation === "update" ? 2 : 1);
      for (const result of results) if (!result.ok) expect(result.error).toMatchObject({ code: "certification_locked" });
    } finally { pauses.afterArtifacts = undefined; await cleanupDocumentUploads(ctx, docs); await cleanupLineageFixture(f); }
  }
}, TEST_TIMEOUT_MS);

it.each(["document", "delete"] as const)("deletable application versus upload, %s first", async firstKind => {
  const f = await postedStockFixture();
  const delivery = await postDelivery(f, 100);
  const app = await runOperationInProcess(recordApplication, f.ctx, appInput(delivery.id, 10), options);
  const docs: string[] = [];
  const barrier = await openOperationBarrier(pool);
  // No Removal exists here. Hold a real parent row before either writer starts.
  await barrier.tx.select().from(schema.deliveries).where(eq(schema.deliveries.id, delivery.id)).for("update");
  const document = () => runOperationInProcess(requestDocumentUploadApp, f.ctx, {
    entityType: "application", entityId: app.id, documentType: "photo",
    fileName: "evidence.jpg", contentType: "image/jpeg", sizeBytes: 8,
    storageProvider: "local-fs", storageBucket: "test",
  }, options).then(row => { docs.push(row.id); return row; });
  const remove = () => runOperationInProcess(deleteApplication, f.ctx, { applicationId: app.id, expectedVersion: app.version }, options);
  const first = outcome(firstKind === "document" ? document() : remove());
  await waitForBlockedOperations(pool, barrier.pid, 1);
  const second = outcome(firstKind === "document" ? remove() : document());
  try { await waitForBlockedOperations(pool, barrier.pid, 2); }
  finally { await barrier.commit(); }
  try {
    expect((await first).ok).toBe(true);
    const result = await second;
    if (firstKind === "document") {
      expect(result.ok).toBe(true);
      const uploaded = await first;
      if (!uploaded.ok) throw new Error("Expected document request");
      const row = uploaded.value as { storageKey: string };
      expect((await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, row.storageKey))).length).toBeGreaterThan(0);
    } else {
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
      if (result.ok || !(result.error instanceof DomainError)) throw new Error("Expected domain refusal");
      expect(actionFailureResponse(toActionFailure(result.error, { fallbackMessage: "Upload failed", log: { message: "Upload failed" } }), "/documents", "application-delete-race").status).toBe(404);
    }
    expect(await db.select().from(schema.applications).where(eq(schema.applications.id, app.id))).toHaveLength(0);
    expect(await db.select().from(schema.documents).where(eq(schema.documents.entityId, app.id))).toHaveLength(0);
  } finally {
    await cleanupDocumentUploads(f.ctx, docs);
    await cleanupPostedStock(f);
  }
}, TEST_TIMEOUT_MS);

it("serializes two creates without exceeding delivery wet mass", async () => {
  const f = await postedStockFixture(); const delivery = await postDelivery(f, 100);
  const ready = gate(); const resume = gate(); const state = { pid: 0 };
  const first = outcome(runOperationInProcess(holdAfterWrite(recordApplication, ready, resume, state), f.ctx, appInput(delivery.id, 60), options));
  await ready.promise;
  const second = outcome(runOperationInProcess(recordApplication, f.ctx, appInput(delivery.id, 60), options));
  try { await waitForBlockedOperations(pool, state.pid, 1); } finally { resume.release(); }
  try {
    expect((await first).ok).toBe(true);
    expect(await second).toMatchObject({ ok: false, error: { code: "conflict" } });
    const rows = await db.select().from(schema.applications).where(eq(schema.applications.deliveryId, delivery.id));
    expect(rows.map(row => row.biocharAppliedTons)).toEqual([0.06]);
  } finally { await cleanupPostedStock(f); }
}, TEST_TIMEOUT_MS);

it.each(["create", "correction"] as const)("create versus delivery stock correction, %s first", async firstKind => {
  const f = await postedStockFixture(); const delivery = await postDelivery(f, 100);
  const [allocation] = await db.select().from(schema.outputStockAllocations).where(eq(schema.outputStockAllocations.deliveryId, delivery.id));
  const preview = await previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.bin.id, kind: "delivery", wetMassKg: 90, moisturePercent: 0, occurredAt: STOCK_TIME, correctsMovementId: allocation.movementId });
  const correctionInput = { deliveryId: delivery.id, expectedVersion: delivery.version, deliveredWetMassKg: 90, moistureContentPercent: 0, expectedProductVersions: preview.expectedProductVersions, basisFingerprint: preview.basisFingerprint };
  const ready = gate(); const resume = gate(); const state = { pid: 0 };
  const first = outcome(firstKind === "create"
    ? runOperationInProcess(holdAfterWrite(recordApplication, ready, resume, state), f.ctx, appInput(delivery.id, 95), options)
    : runOperationInProcess(holdAfterWrite(updatePostedDelivery, ready, resume, state), f.ctx, correctionInput, options));
  await ready.promise;
  const second = outcome(firstKind === "create" ? runOperationInProcess(updatePostedDelivery, f.ctx, correctionInput, options) : runOperationInProcess(recordApplication, f.ctx, appInput(delivery.id, 95), options));
  try { await waitForBlockedOperations(pool, state.pid, 1); } finally { resume.release(); }
  try {
    expect((await first).ok).toBe(true); const rejected = await second; expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(String(rejected.error)).not.toMatch(/deadlock|concurrent_write_retry/);
  } finally { await cleanupPostedStock(f); }
}, TEST_TIMEOUT_MS);

it.each(["create", "archive"] as const)("create versus facility archive, %s first", async firstKind => {
  const f = await postedStockFixture(); const delivery = await postDelivery(f, 100);
  const ready = gate(); const resume = gate(); const state = { pid: 0 };
  let first; let second;
  if (firstKind === "create") {
    first = outcome(runOperationInProcess(holdAfterWrite(recordApplication, ready, resume, state), f.ctx, appInput(delivery.id, 10), options));
    await ready.promise; second = outcome(archiveFacility(f.ctx, f.facility.id, f.facility.version));
    try { await waitForBlockedOperations(pool, state.pid, 1); } finally { resume.release(); }
  } else {
    const barrier = await openOperationBarrier(pool);
    await barrier.tx.select().from(schema.facilities).where(eq(schema.facilities.id, f.facility.id)).for("update");
    first = outcome(archiveFacility(f.ctx, f.facility.id, f.facility.version));
    await waitForBlockedOperations(pool, barrier.pid, 1);
    second = outcome(runOperationInProcess(recordApplication, f.ctx, appInput(delivery.id, 10), options));
    try { await waitForBlockedOperations(pool, barrier.pid, 2); } finally { await barrier.commit(); }
  }
  try { expect((await first).ok).toBe(true); const result = await second;
    if (firstKind === "archive") expect(result).toMatchObject({ ok: false, error: { code: "not_found" } }); else expect(result.ok).toBe(true);
  } finally { await cleanupPostedStock(f); }
}, TEST_TIMEOUT_MS);

it("repoint locks both deliveries before a target create checks capacity", async () => {
  const f = await postedStockFixture(); const source = await postDelivery(f, 100); const target = await postDelivery(f, 100);
  const app = await runOperationInProcess(recordApplication, f.ctx, appInput(source.id, 60), options);
  const ready = gate(); const resume = gate(); const state = { pid: 0 };
  const move = outcome(runOperationInProcess(holdAfterWrite(updateApplication, ready, resume, state), f.ctx, { applicationId: app.id, expectedVersion: 1, deliveryId: target.id }, options));
  await ready.promise;
  const create = outcome(runOperationInProcess(recordApplication, f.ctx, appInput(target.id, 60), options));
  try { await waitForBlockedOperations(pool, state.pid, 1); } finally { resume.release(); }
  try { expect((await move).ok).toBe(true); expect(await create).toMatchObject({ ok: false, error: { code: "conflict" } }); }
  finally { await cleanupPostedStock(f); }
}, TEST_TIMEOUT_MS);

it.each(["application", "removal"] as const)("create versus Removal create serializes at facility, %s first", async firstKind => {
  const f = await createLineageFixture("none"); let removalId: string | undefined;
  await db.update(schema.creditBatchApplications).set({ removalId: null }).where(eq(schema.creditBatchApplications.applicationId, f.applicationId));
  const [delivery] = await db.select().from(schema.deliveries).where(eq(schema.deliveries.id, f.deliveryId));
  const command = { ...appInput(f.deliveryId, 1), applicationDate: "2026-06-16" };
  const ready = gate(); const resume = gate(); const state = { pid: 0 };
  const createRemoval = () => createRemovalWithCreditBatches(ctx, f.facilityId, [f.batchId]).then(id => { removalId = id; return id; });
  let first; let second;
  if (firstKind === "application") {
    first = outcome(runOperationInProcess(holdAfterWrite(recordApplication, ready, resume, state), ctx, command, options));
    await ready.promise; second = outcome(createRemoval());
    try { await waitForBlockedOperations(pool, state.pid, 1); } finally { resume.release(); }
  } else {
    const barrier = await openOperationBarrier(pool);
    await barrier.tx.select().from(schema.facilities).where(eq(schema.facilities.id, delivery.facilityId)).for("update");
    first = outcome(createRemoval()); await waitForBlockedOperations(pool, barrier.pid, 1);
    second = outcome(runOperationInProcess(recordApplication, ctx, command, options));
    try { await waitForBlockedOperations(pool, barrier.pid, 2); } finally { await barrier.commit(); }
  }
  try { expect((await first).ok).toBe(true); const result = await second;
    // A newly discovered Removal answers retryable conflict rather than acquiring its artifact late.
    if (!result.ok) expect(result.error).toMatchObject({ code: "conflict", retryable: true });
    const apps = await db.select().from(schema.applications).where(eq(schema.applications.deliveryId, f.deliveryId));
    expect(apps).toHaveLength(firstKind === "application" || result.ok ? 2 : 1);
    for (const app of apps) {
      const shares = await db.select().from(schema.applicationOutputAllocations).where(eq(schema.applicationOutputAllocations.applicationId, app.id));
      expect(shares.reduce((sum, row) => sum + Number(row.wetMassKg), 0)).toBeCloseTo(app.biocharAppliedTons * 1000);
      const slices = await db.select().from(schema.creditBatchApplications).where(eq(schema.creditBatchApplications.applicationId, app.id));
      expect(slices.map(row => [row.creditBatchId, row.removalId, row.allocatedWetMassKg, row.allocatedDryMassKg])).toEqual([
        [f.batchId, firstKind === "application" || app.id === f.applicationId ? removalId : null, app.biocharAppliedTons * 1000, app.biocharAppliedDryTons! * 1000],
      ]);
    }
  } finally {
    if (removalId) {
      await db.update(schema.creditBatchApplications).set({ removalId: null }).where(eq(schema.creditBatchApplications.removalId, removalId));
      await db.delete(schema.certifierRemovals).where(eq(schema.certifierRemovals.id, removalId));
    }
    const extraApps = await db.select().from(schema.applications).where(and(eq(schema.applications.deliveryId, f.deliveryId), sql`${schema.applications.id} <> ${f.applicationId}`));
    for (const app of extraApps) await database.transaction(async tx => {
      await tx.delete(schema.creditBatchApplications).where(eq(schema.creditBatchApplications.applicationId, app.id));
      await tx.delete(schema.applicationOutputAllocations).where(eq(schema.applicationOutputAllocations.applicationId, app.id));
      await tx.delete(schema.applications).where(eq(schema.applications.id, app.id));
    });
    await cleanupLineageFixture(f);
  }
}, TEST_TIMEOUT_MS);
