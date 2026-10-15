import { createOperationActivity } from "@/lib/operations/activity-links";
import { waitForBlockedOperations } from "./helpers/operation-barrier";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { LocalFsProvider } from "@/lib/storage/local-fs";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import { requestDocumentUploadInTransaction, confirmDocumentUploadInTransaction } from "@/data-access/document-writes";
import { deleteDocumentInTransaction } from "@/data-access/document-mutations";
import { retireDocumentsForEntities } from "@/data-access/documents";
import { prepareDocumentUpload } from "@/lib/documents/upload-preparation";
import { ensureTestOrg, makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";
const ctx = makeTestOrgContext();
const documentIds: string[] = [];
const pool = new Pool({ ...getPgPoolConfig(process.env.DATABASE_URL!), max: 3 });
const database = drizzle(pool, { schema });
let root: string; let provider: LocalFsProvider; let facilityId: string;
function barrier() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(schema.users).values({ id: ctx.userId, email: "document-test@example.test" }).onConflictDoNothing();
  root = await mkdtemp(join(tmpdir(), "document-races-")); provider = new LocalFsProvider({ root, appUrl: "http://localhost", signingSecret: "test" });
  const [facility] = await db.insert(schema.facilities).values({ ...TEST_SITE_POSITION, organizationId: ctx.organizationId, code: `RACE-${Date.now()}`, name: "Document race", timezone: "UTC" }).returning(); facilityId = facility.id;
});
afterAll(async () => {
  await cleanupDocumentUploads(ctx, documentIds);
  await pool.end();
  if (facilityId) { await db.delete(schema.documents).where(eq(schema.documents.entityId, facilityId)); await db.delete(schema.facilities).where(eq(schema.facilities.id, facilityId)); }
  if (root) await rm(root, { recursive: true, force: true });
});
async function pending(ownerId = facilityId) {
  const row = await db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, { entityType: "facility", entityId: ownerId, documentType: "pdf", fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8, storageProvider: provider.name, storageBucket: provider.bucket }));
  documentIds.push(row.id); return row;
}
async function prepare(id: string) { const result = await prepareDocumentUpload(ctx, id, provider); if (result.kind !== "prepared") throw new Error("Expected pending upload"); return result.facts; }
it.each([false, true])("double confirm preserves the winner and queues only a different losing key (tamper=%s)", async (tamper) => {
  const row = await pending(); await provider.putObject(row.storageKey!, Buffer.from("%PDF-1.7"), "application/pdf");
  const first = await prepare(row.id);
  if (tamper) await provider.putObject(row.storageKey!, Buffer.from("%PDF-1.6"), "application/pdf");
  const second = await prepare(row.id);
  const written = barrier(); const commit = barrier(); const entered = barrier();
  let blockerPid = 0;
  const winner = database.transaction(async (tx) => { blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid; const result = await confirmDocumentUploadInTransaction(ctx, tx, first); written.release(); await commit.promise; return result; });
  await written.promise;
  const loser = database.transaction(async (tx) => { entered.release(); return confirmDocumentUploadInTransaction(ctx, tx, second); });
  await entered.promise;
  try { await waitForBlockedOperations(pool, blockerPid, 1); } finally { commit.release(); }
  expect((await Promise.all([winner, loser])).map((result) => result.kind)).toEqual(["uploaded", tamper ? "gone" : "uploaded"]);
  const [saved] = await db.select().from(schema.documents).where(eq(schema.documents.id, row.id));
  expect(saved).toMatchObject({ version: 2, storageKey: first.finalKey });
  const queued = await db.select().from(schema.storageObjectDeletions).where(and(eq(schema.storageObjectDeletions.organizationId, ctx.organizationId), eq(schema.storageObjectDeletions.storageKey, first.finalKey!)));
  expect(queued).toHaveLength(0);
  if (tamper) expect((await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, second.finalKey!))).length).toBeGreaterThan(0);
});
it.each(["app", "owner"] as const)("cleans promotion after %s deletion wins", async (mode) => {
  const [owner] = mode === "owner" ? await db.insert(schema.facilities).values({ ...TEST_SITE_POSITION, organizationId: ctx.organizationId, code: `RETIRE-${Date.now()}`, name: "Retirement test", timezone: "UTC" }).returning() : [{ id: facilityId }];
  const row = await pending(owner.id); await provider.putObject(row.storageKey!, Buffer.from("%PDF-1.7"), "application/pdf"); const facts = await prepare(row.id);
  const removed = barrier(); const commit = barrier(); const entered = barrier();
  let blockerPid = 0;
  const deletion = database.transaction(async (tx) => {
    blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
    if (mode === "app") await deleteDocumentInTransaction(ctx, tx, { documentId: row.id, expectedVersion: row.version });
    else {
      await tx.select().from(schema.facilities).where(eq(schema.facilities.id, owner.id)).for("update");
      await retireDocumentsForEntities(ctx, tx, [{ entityType: "facility", entityId: owner.id }]);
      await tx.delete(schema.facilities).where(eq(schema.facilities.id, owner.id));
    }
    removed.release(); await commit.promise;
  });
  await removed.promise;
  let confirmPid = 0;
  const confirmation = database.transaction(async (tx) => { confirmPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid; entered.release(); return confirmDocumentUploadInTransaction(ctx, tx, facts); });
  await entered.promise;
  try { expect(await waitForBlockedOperations(pool, blockerPid, 1)).toContain(confirmPid); } finally { commit.release(); }
  await deletion;
  expect(await confirmation).toEqual({ kind: "gone" });
  await provider.putObject(row.uploadStorageKey!, Buffer.from("late PUT"), "application/pdf");
  const deferred = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, row.uploadStorageKey!));
  expect(deferred.some((entry) => entry.notBefore && entry.notBefore > new Date() && !entry.completedAt)).toBe(true);
  expect(await db.select().from(schema.documents).where(eq(schema.documents.id, row.id))).toHaveLength(0);
  const queued = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, facts.finalKey!)); expect(queued.length).toBeGreaterThan(0);
});
it("commits a failed confirmation when Removal submission wins the artifact lock", async () => {
  const { createLineageFixture, cleanupLineageFixture } = await import("./helpers/certification-lineage-fixture");
  const { lockCertifiedLineageArtifacts } = await import("@/data-access/certification-lineage-guards");
  const fixture = await createLineageFixture("none");
  const row = await db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, { entityType: "sample", entityId: fixture.sampleId, documentType: "pdf", fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8, storageProvider: provider.name, storageBucket: provider.bucket }));
  documentIds.push(row.id);
  try {
    await provider.putObject(row.storageKey!, Buffer.from("%PDF-1.7"), "application/pdf"); const facts = await prepare(row.id);
    const submitted = barrier(); const commit = barrier(); const entered = barrier();
    let blockerPid = 0;
    const submit = database.transaction(async (tx) => {
      blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
      await lockCertifiedLineageArtifacts(ctx, tx, [{ entityType: "sample", entityId: fixture.sampleId }]);
      await tx.insert(schema.certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId, version: 1, status: "submitted", payloadHash: "document-race", payloadSnapshot: {}, submittedAt: new Date() });
      submitted.release(); await commit.promise;
    });
    await submitted.promise;
    let confirmPid = 0;
    const confirm = database.transaction(async (tx) => { confirmPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid; entered.release(); return confirmDocumentUploadInTransaction(ctx, tx, facts); });
    await entered.promise;
    try { expect(await waitForBlockedOperations(pool, blockerPid, 1)).toContain(confirmPid); } finally { commit.release(); }
    await submit;
    expect(await confirm).toMatchObject({ kind: "refused", reason: "certification_locked", pointer: "/labSampleId", document: { uploadStatus: "failed", version: 2 } });
    const [saved] = await db.select().from(schema.documents).where(eq(schema.documents.id, row.id)); expect(saved.uploadStatus).toBe("failed");
    expect(await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, facts.finalKey!))).toHaveLength(1);
  } finally { await db.delete(schema.documents).where(eq(schema.documents.id, row.id)); await cleanupLineageFixture(fixture); }
});
it.each((["delivery", "sample-batch", "feedstock"] as const).flatMap((owner) =>
  (["archive", "request"] as const).map((first) => ({ owner, first })),
))("serializes $owner evidence and ancestor archive with $first first", async ({ owner, first }) => {
  const { archiveFacility } = await import("@/data-access/facilities");
  const { createLineageFixture, cleanupLineageFixture } = await import("./helpers/certification-lineage-fixture");
  const fixture = await createLineageFixture("none");
  const entityType = owner.startsWith("sample") ? "sample" as const : owner === "delivery" ? "delivery" as const : "feedstock" as const;
  const entityId = entityType === "sample" ? fixture.sampleId : entityType === "delivery" ? fixture.deliveryId : fixture.feedstockId;
  const archive = () => owner === "sample-batch"
    ? database.transaction(async (tx) => {
      const table = schema.creditBatches;
      const id = fixture.batchId;
      await tx.update(table).set({ archivedAt: new Date() }).where(and(eq(table.id, id), eq(table.organizationId, ctx.organizationId)));
    }) : archiveFacility(ctx, fixture.facilityId, 1);
  const input = { entityType, entityId, documentType: "pdf" as const, fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8, storageProvider: provider.name, storageBucket: provider.bucket };
  const ids: string[] = [];
  try {
    if (first === "archive") {
      await archive();
      await expect(db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, input))).rejects.toMatchObject({ code: "not_found", issues: [{ path: [entityType === "sample" ? "labSampleId" : `${entityType}Id`] }] });
    } else {
      const saved = barrier(); const commit = barrier(); let blockerPid = 0;
      const request = database.transaction(async (tx) => {
        blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
        const row = await requestDocumentUploadInTransaction(ctx, tx, input);
        ids.push(row.id); saved.release(); await commit.promise; return row;
      });
      await saved.promise;
      const archiving = archive();
      try { await waitForBlockedOperations(pool, blockerPid, 1); } finally { commit.release(); }
      expect((await request).uploadStatus).toBe("pending"); await archiving;
      await expect(db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, input))).rejects.toMatchObject({ code: "not_found" });
    }
  } finally {
    await cleanupDocumentUploads(ctx, ids);
    await cleanupLineageFixture(fixture);
  }
});

it.each(["app", "owner", "submit"] as const)("lets confirm commit before a blocked %s writer", async (mode) => {
  const { createLineageFixture, cleanupLineageFixture } = await import("./helpers/certification-lineage-fixture");
  const { lockCertifiedLineageArtifacts } = await import("@/data-access/certification-lineage-guards");
  const fixture = await createLineageFixture("none");
  const row = await db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, { entityType: "sample", entityId: fixture.sampleId, documentType: "pdf", fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8, storageProvider: provider.name, storageBucket: provider.bucket }));
  documentIds.push(row.id);
  try {
    await provider.putObject(row.storageKey!, Buffer.from("%PDF-1.7"), "application/pdf");
    const facts = await prepare(row.id);
    const written = barrier(); const commit = barrier(); let blockerPid = 0;
    const confirm = database.transaction(async (tx) => {
      blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
      const outcome = await confirmDocumentUploadInTransaction(ctx, tx, facts);
      written.release(); await commit.promise; return outcome;
    });
    await written.promise;
    const competing = database.transaction(async (tx) => {
      if (mode === "app") return deleteDocumentInTransaction(ctx, tx, { documentId: row.id, expectedVersion: row.version + 1 });
      if (mode === "owner") {
        await tx.select().from(schema.samples).where(eq(schema.samples.id, fixture.sampleId)).for("update");
        await retireDocumentsForEntities(ctx, tx, [{ entityType: "sample", entityId: fixture.sampleId }]);
        await tx.delete(schema.samples).where(eq(schema.samples.id, fixture.sampleId));
      } else {
        await lockCertifiedLineageArtifacts(ctx, tx, [{ entityType: "sample", entityId: fixture.sampleId }]);
        await tx.insert(schema.certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId, version: 1, status: "submitted", payloadHash: "confirm-first", payloadSnapshot: {}, submittedAt: new Date() });
      }
    });
    try { await waitForBlockedOperations(pool, blockerPid, 1); } finally { commit.release(); }
    expect(await confirm).toMatchObject({ kind: "uploaded" });
    await competing;
    const saved = await db.select().from(schema.documents).where(eq(schema.documents.id, row.id));
    if (mode === "submit") expect(saved).toMatchObject([{ uploadStatus: "uploaded", storageKey: facts.finalKey }]);
    else expect(saved).toHaveLength(0);
    const finalKeys = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, facts.finalKey!));
    if (mode === "submit") expect(finalKeys).toHaveLength(0);
    else expect(finalKeys).toMatchObject([{ notBefore: expect.any(Date), completedAt: null }]);
    const uploads = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, row.uploadStorageKey!));
    expect(uploads.length).toBeGreaterThan(0);
    expect(uploads.every((entry) => entry.notBefore && entry.notBefore > row.uploadExpiresAt! && !entry.completedAt)).toBe(true);
  } finally { await cleanupDocumentUploads(ctx, [row.id]); await cleanupLineageFixture(fixture); }
});

it.each(["refusal", "expiry"] as const)("app, REST and MCP preserve the stored reason after a committed %s wins", async (winner) => {
  const { confirmDocumentUploadApp } = await import("@/lib/operations/documents");
  const { confirmInspectedDocumentUpload } = await import("@/lib/operations/document-upload-confirm");
  const { documentFromConfirmOutcome, mapConfirmOutcome } = await import("@/lib/documents/confirm-outcome");
  const { expireDocumentUploadsInTransaction } = await import("@/data-access/document-upload-sweep");
  const { DOCUMENT_UPLOAD_GRACE_MS } = await import("@/config/documents");
  for (const transport of ["app", "rest", "mcp"] as const) {
    const row = await pending();
    const facts = { ... (await import("@/data-access/document-writes")).uploadFactsFor(row), refusal: "size" as const, cleanupDeadlineAt: Date.now() };
    if (winner === "expiry") await db.update(schema.documents).set({ uploadExpiresAt: new Date(Date.now() - DOCUMENT_UPLOAD_GRACE_MS - 1) }).where(eq(schema.documents.id, row.id));
    const locked = barrier(); const commit = barrier(); let blockerPid = 0;
    const winning = database.transaction(async (tx) => {
      blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
      if (winner === "expiry") await expireDocumentUploadsInTransaction(tx, new Date(), [ctx.organizationId]);
      else await confirmDocumentUploadInTransaction(ctx, tx, facts);
      locked.release(); await commit.promise;
    });
    await locked.promise;
    const scope = (tx: Parameters<typeof confirmDocumentUploadApp.execute>[0]["tx"]) => ({ ctx, tx, activity: createOperationActivity(), afterCommit: vi.fn() });
    const losing = database.transaction(async (tx) => transport === "app"
      ? confirmDocumentUploadApp.execute(scope(tx), facts)
      : confirmInspectedDocumentUpload.execute(scope(tx), facts));
    try { await waitForBlockedOperations(pool, blockerPid, 1); } finally { commit.release(); }
    await winning;
    const outcome = await losing;
    const reason = winner === "expiry" ? "expired" : "size";
    expect(outcome).toMatchObject({ kind: "failed", reason });
    if (transport === "app") expect(() => documentFromConfirmOutcome(outcome as Awaited<ReturnType<typeof confirmDocumentUploadApp.execute>>)).toThrow(expect.objectContaining({ code: "conflict", issues: [expect.objectContaining({ code: reason })] }));
    else expect(mapConfirmOutcome(outcome as Awaited<ReturnType<typeof confirmInspectedDocumentUpload.execute>>)).toMatchObject({ status: 409, error: { code: "conflict", issues: [expect.objectContaining({ code: reason })] } });
  }
});

it.each(["sweep", "delete", "owner"] as const)("keeps a candidate durable after PUT abort, for %s cleanup", async (cleanup) => {
  const { expireDocumentUploadsInTransaction } = await import("@/data-access/document-upload-sweep");
  const { DOCUMENT_UPLOAD_GRACE_MS } = await import("@/config/documents");
  const row = await pending();
  await provider.putObject(row.uploadStorageKey!, Buffer.from("%PDF-1.7"), "application/pdf");
  const put = provider.putObject.bind(provider);
  let finalKey = "";
  const interrupted = vi.spyOn(provider, "putObject").mockImplementation(async (key, bytes, contentType, options) => {
    await put(key, bytes, contentType, options); finalKey = key;
    throw new DOMException("Aborted after PUT", "AbortError");
  });
  try { await expect(prepare(row.id)).rejects.toMatchObject({ code: "deadline_exceeded" }); }
  finally { interrupted.mockRestore(); }
  const [recorded] = await db.select().from(schema.documents).where(eq(schema.documents.id, row.id));
  expect(recorded).toMatchObject({ uploadStatus: "pending", metadata: { promotionCandidates: [finalKey] } });
  expect(await provider.headObject(finalKey)).not.toBeNull();
  if (cleanup === "delete") await db.transaction((tx) => deleteDocumentInTransaction(ctx, tx, { documentId: row.id, expectedVersion: row.version }));
  else if (cleanup === "owner") await db.transaction((tx) => retireDocumentsForEntities(ctx, tx, [{ entityType: "facility", entityId: facilityId }]));
  else {
    await db.update(schema.documents).set({ uploadExpiresAt: new Date(Date.now() - DOCUMENT_UPLOAD_GRACE_MS - 1) }).where(eq(schema.documents.id, row.id));
    await db.transaction((tx) => expireDocumentUploadsInTransaction(tx, new Date(), [ctx.organizationId]));
  }
  const queued = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, finalKey));
  expect(queued.length).toBeGreaterThan(0);
});

it("successful confirm queues prior candidates even when their runner never ran, excluding the live key", async () => {
  const row = await pending();
  await provider.putObject(row.uploadStorageKey!, Buffer.from("%PDF-1.7"), "application/pdf");
  const abandoned = await prepare(row.id);
  await provider.putObject(row.uploadStorageKey!, Buffer.from("%PDF-1.6"), "application/pdf");
  const winner = await prepare(row.id);
  expect(await db.transaction((tx) => confirmDocumentUploadInTransaction(ctx, tx, winner))).toMatchObject({ kind: "uploaded" });
  expect((await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, abandoned.finalKey!))).length).toBeGreaterThan(0);
  expect(await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, winner.finalKey!))).toHaveLength(0);
});

it.each(["app", "owner"] as const)("defers live-key cleanup past an identical late PUT on %s deletion", async (mode) => {
  const { processPendingStorageObjectDeletions } = await import("@/data-access/storage-object-deletions");
  const { __setStorageProviderForTests } = await import("@/lib/storage");
  const row = await pending();
  await provider.putObject(row.uploadStorageKey!, Buffer.from("%PDF-1.7"), "application/pdf");
  const first = await prepare(row.id);
  const entered = barrier(); const resume = barrier();
  const put = provider.putObject.bind(provider);
  const latePut = vi.spyOn(provider, "putObject").mockImplementationOnce(async (...args) => {
    entered.release(); await resume.promise; await put(...args);
  });
  const second = prepare(row.id);
  await entered.promise;
  __setStorageProviderForTests(provider);
  try {
    const confirmed = await db.transaction(tx => confirmDocumentUploadInTransaction(ctx, tx, first));
    if (confirmed.kind !== "uploaded") throw new Error("Expected uploaded");
    if (mode === "app") await db.transaction(tx => deleteDocumentInTransaction(ctx, tx, { documentId: row.id, expectedVersion: confirmed.document.version }));
    else await db.transaction(tx => retireDocumentsForEntities(ctx, tx, [{ entityType: "facility", entityId: row.entityId }]));
    await processPendingStorageObjectDeletions(ctx);
    const [queued] = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, first.finalKey!));
    expect(queued.notBefore!.getTime()).toBeGreaterThan(Date.now());
    expect(queued.completedAt).toBeNull();
    resume.release(); await second;
    expect(await provider.headObject(first.finalKey!)).not.toBeNull();
    // Advance the queue's clock without sleeping through the confirmation budget.
    await db.update(schema.storageObjectDeletions).set({ notBefore: new Date(0) }).where(eq(schema.storageObjectDeletions.id, queued.id));
    await processPendingStorageObjectDeletions(ctx);
    expect(await provider.headObject(first.finalKey!)).toBeNull();
  } finally { resume.release(); await second; latePut.mockRestore(); __setStorageProviderForTests(null); }
});
