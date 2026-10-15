import { waitForBlockedOperations } from "./helpers/operation-barrier";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";
import { afterAll, beforeAll, expect, it } from "vitest";
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
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
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
  const [facility] = await db.insert(schema.facilities).values({ organizationId: ctx.organizationId, code: `RACE-${Date.now()}`, name: "Document race", timezone: "UTC" }).returning(); facilityId = facility.id;
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
  if (tamper) expect(await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, second.finalKey!))).toHaveLength(1);
});
it.each(["app", "owner"] as const)("cleans promotion after %s deletion wins", async (mode) => {
  const [owner] = mode === "owner" ? await db.insert(schema.facilities).values({ organizationId: ctx.organizationId, code: `RETIRE-${Date.now()}`, name: "Retirement test", timezone: "UTC" }).returning() : [{ id: facilityId }];
  const row = await pending(owner.id); await provider.putObject(row.storageKey!, Buffer.from("%PDF-1.7"), "application/pdf"); const facts = await prepare(row.id);
  const removed = barrier(); const commit = barrier(); const entered = barrier();
  let blockerPid = 0;
  const deletion = database.transaction(async (tx) => {
    blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
    if (mode === "app") await deleteDocumentInTransaction(ctx, tx, { documentId: row.id });
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
  const queued = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, facts.finalKey!)); expect(queued).toHaveLength(1);
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
it.each(["archive", "request"] as const)("serializes delivery evidence and facility archive with %s first", async (first) => {
  const { archiveFacility } = await import("@/data-access/facilities");
  const { createLineageFixture, cleanupLineageFixture } = await import("./helpers/certification-lineage-fixture");
  const fixture = await createLineageFixture("none");
  const input = { entityType: "delivery" as const, entityId: fixture.deliveryId, documentType: "pdf" as const, fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8, storageProvider: provider.name, storageBucket: provider.bucket };
  const ids: string[] = [];
  try {
    if (first === "archive") {
      await archiveFacility(ctx, fixture.facilityId, 1);
      await expect(db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, input))).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["deliveryId"] }] });
    } else {
      const saved = barrier(); const commit = barrier(); let blockerPid = 0;
      const request = database.transaction(async (tx) => {
        blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
        const row = await requestDocumentUploadInTransaction(ctx, tx, input);
        ids.push(row.id); saved.release(); await commit.promise; return row;
      });
      await saved.promise;
      const archive = archiveFacility(ctx, fixture.facilityId, 1);
      try { await waitForBlockedOperations(pool, blockerPid, 1); } finally { commit.release(); }
      expect((await request).uploadStatus).toBe("pending"); await archive;
      await expect(db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, input))).rejects.toMatchObject({ code: "not_found" });
    }
  } finally { await cleanupDocumentUploads(ctx, ids); await cleanupLineageFixture(fixture); }
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
      if (mode === "app") return deleteDocumentInTransaction(ctx, tx, { documentId: row.id });
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
    else expect(finalKeys).toMatchObject([{ notBefore: null, completedAt: null }]);
    const uploads = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, row.uploadStorageKey!));
    expect(uploads.length).toBeGreaterThan(0);
    expect(uploads.every((entry) => entry.notBefore && entry.notBefore > row.uploadExpiresAt! && !entry.completedAt)).toBe(true);
  } finally { await cleanupDocumentUploads(ctx, [row.id]); await cleanupLineageFixture(fixture); }
});
