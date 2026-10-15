import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { DOCUMENT_SWEEP_BATCH_SIZE, DOCUMENT_FAILED_RETENTION_MS, DOCUMENT_UPLOAD_GRACE_MS } from "@/config/documents";
import { sweepDocumentUploads, expireDocumentUploadsInTransaction, retireFailedDocumentUploadsInTransaction } from "@/data-access/document-upload-sweep";
import { renewDocumentUploadInTransaction } from "@/data-access/document-upload-renewal";
import { uploadFactsFor, requestDocumentUploadInTransaction } from "@/data-access/document-writes";
import { drainStorageObjectDeletionsAcrossOrganizations, enqueueStorageObjectDeletion } from "@/data-access/storage-object-deletions";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import { __setStorageProviderForTests } from "@/lib/storage";
import { RetirementStorageProvider } from "./helpers/document-retirement";
import { waitForBlockedOperations } from "./helpers/operation-barrier";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";

const MINUTE_MS = 60_000;
const DRAIN_BUDGET_MS = 2_000;
const provider = new RetirementStorageProvider();
const pool = new Pool({ ...getPgPoolConfig(process.env.DATABASE_URL!), max: 3 });
const database = drizzle(pool, { schema });
const contexts = [randomUUID(), randomUUID()].map((organizationId) => ({ organizationId, userId: randomUUID(), orgRole: "owner" as const, isPlatformAdmin: false }));
const organizationIds = contexts.map((ctx) => ctx.organizationId);
const ids: string[] = [];
let facilityId: string;
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
beforeAll(async () => {
  for (const ctx of contexts) {
    await db.insert(schema.organizations).values({ id: ctx.organizationId, name: "Upload sweep test", slug: ctx.organizationId });
    await db.insert(schema.users).values({ id: ctx.userId, email: `${ctx.userId}@example.test` });
  }
  const [facility] = await db.insert(schema.facilities).values({ organizationId: contexts[0].organizationId, code: "SWEEP", name: "Sweep fixture", timezone: "UTC" }).returning();
  facilityId = facility.id;
  __setStorageProviderForTests(provider);
});
afterAll(async () => {
  __setStorageProviderForTests(null);
  await cleanupDocumentUploads(contexts[0], ids);
  await db.delete(schema.facilities).where(eq(schema.facilities.id, facilityId));
  for (const ctx of contexts) {
    await db.delete(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.organizationId, ctx.organizationId));
    await db.delete(schema.organizations).where(eq(schema.organizations.id, ctx.organizationId));
    await db.delete(schema.users).where(eq(schema.users.id, ctx.userId));
  }
  await pool.end();
});
async function pending() {
  const row = await db.transaction((tx) => requestDocumentUploadInTransaction(contexts[0], tx, {
    entityType: "facility", entityId: facilityId, documentType: "pdf", fileName: "sweep.pdf",
    contentType: "application/pdf", sizeBytes: 8, storageProvider: provider.name, storageBucket: provider.bucket,
  }));
  ids.push(row.id);
  // Within the one-hour lifetime, but the prior lease and grace have elapsed.
  await db.update(schema.documents).set({ uploadExpiresAt: new Date(Date.now() - DOCUMENT_UPLOAD_GRACE_MS - MINUTE_MS) }).where(eq(schema.documents.id, row.id));
  return row;
}
async function read(id: string) {
  return (await db.select().from(schema.documents).where(eq(schema.documents.id, id)))[0];
}
async function queued(key: string) {
  return db.select().from(schema.storageObjectDeletions).where(and(eq(schema.storageObjectDeletions.organizationId, contexts[0].organizationId), eq(schema.storageObjectDeletions.storageKey, key)));
}
it("expires pending once, preserving the declaration and deferring its one queued key", async () => {
  const row = await pending();
  const before = await read(row.id);
  await database.transaction((tx) => expireDocumentUploadsInTransaction(tx, new Date(), organizationIds));
  await database.transaction((tx) => expireDocumentUploadsInTransaction(tx, new Date(), organizationIds));
  expect(await read(row.id)).toMatchObject({ uploadStatus: "failed", version: row.version + 1, metadata: { ...row.metadata as object, uploadFailure: { reason: "expired" } } });
  const entries = await queued(row.uploadStorageKey!);
  expect(entries).toHaveLength(1);
  expect(entries[0].notBefore?.getTime()).toBe(before.uploadExpiresAt!.getTime() + DOCUMENT_UPLOAD_GRACE_MS);
});
it.each(["renewal", "sweep"] as const)("serializes renewal and expiry with %s first", async (first) => {
  const row = await pending();
  const before = await read(row.id);
  const locked = barrier();
  const commit = barrier();
  let blockerPid = 0;
  const winner = database.transaction(async (tx) => {
    blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
    const result = first === "renewal"
      ? await renewDocumentUploadInTransaction(contexts[0], tx, row.id)
      : await expireDocumentUploadsInTransaction(tx, new Date(), organizationIds);
    locked.release();
    await commit.promise;
    return result;
  });
  await locked.promise;
  if (first === "renewal") {
    try {
      // A separate connection skips the held row instead of waiting on it.
      await database.transaction((tx) => expireDocumentUploadsInTransaction(tx, new Date(), organizationIds));
    } finally { commit.release(); }
    expect(await winner).toMatchObject({ kind: "renewed" });
    await database.transaction((tx) => expireDocumentUploadsInTransaction(tx, new Date(), organizationIds));
    expect(await read(row.id)).toMatchObject({ uploadStatus: "pending", version: row.version });
    expect((await read(row.id)).uploadExpiresAt!.getTime()).toBeGreaterThan(before.uploadExpiresAt!.getTime());
    expect(await queued(row.uploadStorageKey!)).toHaveLength(0);
  } else {
    const loser = database.transaction((tx) => renewDocumentUploadInTransaction(contexts[0], tx, row.id));
    try { await waitForBlockedOperations(pool, blockerPid, 1); } finally { commit.release(); }
    await winner;
    expect(await loser).toEqual({ kind: "unavailable", reason: "expired" });
    expect(await read(row.id)).toMatchObject({ uploadStatus: "failed", version: row.version + 1, uploadExpiresAt: before.uploadExpiresAt });
    expect(await queued(row.uploadStorageKey!)).toHaveLength(1);
  }
});
it("retires only old failed rows whose keys have all been queued", async () => {
  const old = await pending(); const young = await pending(); const unqueued = await pending();
  const now = new Date();
  await database.transaction((tx) => expireDocumentUploadsInTransaction(tx, now, organizationIds));
  for (const row of [old, unqueued]) await db.update(schema.documents).set({ updatedAt: new Date(now.getTime() - DOCUMENT_FAILED_RETENTION_MS - MINUTE_MS) }).where(eq(schema.documents.id, row.id));
  await db.delete(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.storageKey, unqueued.uploadStorageKey!));
  await db.update(schema.storageObjectDeletions).set({ completedAt: now }).where(eq(schema.storageObjectDeletions.storageKey, old.uploadStorageKey!));
  await database.transaction((tx) => retireFailedDocumentUploadsInTransaction(tx, now, organizationIds));
  expect(await read(old.id)).toBeUndefined();
  expect(await read(young.id)).toMatchObject({ uploadStatus: "failed" });
  expect(await read(unqueued.id)).toMatchObject({ uploadStatus: "failed" });
  expect(await queued(old.uploadStorageKey!)).toHaveLength(1);
});
it("drains due keys across two organizations and keeps future keys", async () => {
  for (const ctx of contexts) {
    for (const deferred of [false, true]) {
      const storageKey = `org/${ctx.organizationId}/uploads/${randomUUID()}`;
      await provider.putObject(storageKey);
      await db.transaction((tx) => enqueueStorageObjectDeletion(ctx, tx, {
        storageProvider: provider.name, storageBucket: provider.bucket, storageKey,
        notBefore: new Date(Date.now() + (deferred ? MINUTE_MS : -MINUTE_MS)),
      }));
    }
  }
  await drainStorageObjectDeletionsAcrossOrganizations(DRAIN_BUDGET_MS, organizationIds);
  for (const ctx of contexts) {
    const entries = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.organizationId, ctx.organizationId));
    expect(entries.some((entry) => entry.completedAt !== null)).toBe(true);
    for (const entry of entries.filter((entry) => entry.notBefore! > new Date())) {
      expect(entry.completedAt).toBeNull();
      expect(provider.objects.has(entry.storageKey)).toBe(true);
    }
  }
});


it("leaves uploaded rows and pending rows inside the expiry grace untouched", async () => {
  const uploaded = await pending();
  const grace = await pending();
  await db.update(schema.documents).set({ uploadStatus: "uploaded" }).where(eq(schema.documents.id, uploaded.id));
  await db.update(schema.documents).set({ uploadExpiresAt: new Date(Date.now() - MINUTE_MS) }).where(eq(schema.documents.id, grace.id));
  await database.transaction((tx) => expireDocumentUploadsInTransaction(tx, new Date(), organizationIds));
  expect(await read(uploaded.id)).toMatchObject({ uploadStatus: "uploaded", version: uploaded.version });
  expect(await read(grace.id)).toMatchObject({ uploadStatus: "pending", version: grace.version });
  expect(await queued(uploaded.uploadStorageKey!)).toHaveLength(0);
  expect(await queued(grace.uploadStorageKey!)).toHaveLength(0);
});

it("expires more than one batch in a single sweep", async () => {
  const template = await pending();
  const rows = Array.from({ length: DOCUMENT_SWEEP_BATCH_SIZE }, () => {
    const id = randomUUID();
    ids.push(id);
    const key = `org/${contexts[0].organizationId}/uploads/${id}`;
    return { ...template, id, storageKey: key, uploadStorageKey: key,
      uploadExpiresAt: new Date(Date.now() - DOCUMENT_UPLOAD_GRACE_MS - MINUTE_MS) };
  });
  await db.insert(schema.documents).values(rows);
  const result = await sweepDocumentUploads(new Date(), organizationIds);
  expect(result.expired).toBeGreaterThanOrEqual(DOCUMENT_SWEEP_BATCH_SIZE + 1);
  for (const row of [template, ...rows]) expect(await read(row.id)).toMatchObject({ uploadStatus: "failed" });
});

it("hands off distinct final and live upload keys before failed-row retention", async () => {
  const { enqueueDocumentKeys } = await import("@/data-access/document-storage-deletions");
  const row = await pending();
  const finalKey = `org/${contexts[0].organizationId}/final/${row.id}`;
  const uploadExpiresAt = new Date(Date.now() + MINUTE_MS);
  await db.update(schema.documents).set({
    uploadStatus: "failed", storageKey: finalKey, uploadExpiresAt,
    updatedAt: new Date(Date.now() - DOCUMENT_FAILED_RETENTION_MS - MINUTE_MS),
  }).where(eq(schema.documents.id, row.id));
  await database.transaction(async (tx) => {
    await enqueueDocumentKeys(contexts[0], tx, await read(row.id));
    await retireFailedDocumentUploadsInTransaction(tx, new Date(), organizationIds);
  });
  expect(await read(row.id)).toBeUndefined();
  expect(await queued(finalKey)).toMatchObject([{ notBefore: null, completedAt: null }]);
  expect(await queued(row.uploadStorageKey!)).toMatchObject([{
    notBefore: new Date(uploadExpiresAt.getTime() + DOCUMENT_UPLOAD_GRACE_MS), completedAt: null,
  }]);
});

it("stops the cross-org drain at its budget when a provider delete stalls", async () => {
  const stallBudgetMs = 100;
  const maximumElapsedMs = 2_000;
  const ctx = contexts[1];
  await db.delete(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.organizationId, ctx.organizationId));
  for (let i = 0; i < 2; i++) await db.transaction((tx) => enqueueStorageObjectDeletion(ctx, tx, {
    storageProvider: provider.name, storageBucket: provider.bucket,
    storageKey: `org/${ctx.organizationId}/uploads/${randomUUID()}`,
  }));
  const stalled = vi.spyOn(provider, "deleteObject").mockImplementation(() => new Promise<void>(() => {}));
  try {
    const start = Date.now();
    const result = await drainStorageObjectDeletionsAcrossOrganizations(stallBudgetMs, [ctx.organizationId]);
    expect(Date.now() - start).toBeLessThan(maximumElapsedMs);
    expect(result).toEqual({ completed: 0, failed: 0, deferred: 1 });
    expect(stalled).toHaveBeenCalledOnce();
    const entries = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.organizationId, ctx.organizationId));
    expect(entries.every((entry) => entry.completedAt === null)).toBe(true);
  } finally { stalled.mockRestore(); }
});

it("returns 409 expired when a sweep wins against an inspected confirmation", async () => {
  const { confirmInspectedDocumentUpload } = await import("@/lib/operations/document-upload-confirm");
  const { mapConfirmOutcome } = await import("@/lib/documents/confirm-outcome");
  const row = await pending();
  const facts = { ...uploadFactsFor(row), refusal: "size" as const, cleanupDeadlineAt: Date.now() };
  const locked = barrier();
  const commit = barrier();
  let blockerPid = 0;
  const sweep = database.transaction(async (tx) => {
    blockerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
    await expireDocumentUploadsInTransaction(tx, new Date(), organizationIds);
    locked.release();
    await commit.promise;
  });
  await locked.promise;
  const confirm = database.transaction((tx) => confirmInspectedDocumentUpload.execute({
    ctx: contexts[0], tx, afterCommit: vi.fn(),
  }, facts));
  try { await waitForBlockedOperations(pool, blockerPid, 1); } finally { commit.release(); }
  await sweep;
  const outcome = await confirm;
  expect(outcome).toMatchObject({ kind: "failed", reason: "expired" });
  expect(mapConfirmOutcome(outcome)).toMatchObject({ status: 409, error: { issues: [{ code: "expired" }] } });
});

it.each(["provider", "bucket"] as const)("excludes a mismatched %s from the cross-org drain", async (mismatch) => {
  const ctx = contexts[1];
  await db.delete(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.organizationId, ctx.organizationId));
  await db.transaction((tx) => enqueueStorageObjectDeletion(ctx, tx, {
    storageProvider: mismatch === "provider" ? "other-provider" : provider.name,
    storageBucket: mismatch === "bucket" ? "other-bucket" : provider.bucket,
    storageKey: `org/${ctx.organizationId}/uploads/${randomUUID()}`,
  }));
  const deleted = vi.spyOn(provider, "deleteObject");
  try {
    expect(await drainStorageObjectDeletionsAcrossOrganizations(DRAIN_BUDGET_MS, [ctx.organizationId])).toEqual({ completed: 0, failed: 0, deferred: 0 });
    expect(deleted).not.toHaveBeenCalled();
    const [entry] = await db.select().from(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.organizationId, ctx.organizationId));
    expect(entry).toMatchObject({ attemptCount: 0, lastErrorCode: null, completedAt: null });
  } finally { deleted.mockRestore(); }
});

it("counts a provider delete error as a real drain failure", async () => {
  const ctx = contexts[1];
  await db.delete(schema.storageObjectDeletions).where(eq(schema.storageObjectDeletions.organizationId, ctx.organizationId));
  await db.transaction((tx) => enqueueStorageObjectDeletion(ctx, tx, {
    storageProvider: provider.name, storageBucket: provider.bucket, storageKey: `org/${ctx.organizationId}/uploads/${randomUUID()}`,
  }));
  const deleted = vi.spyOn(provider, "deleteObject").mockRejectedValue(new Error("provider unavailable"));
  try { expect(await drainStorageObjectDeletionsAcrossOrganizations(DRAIN_BUDGET_MS, [ctx.organizationId])).toEqual({ completed: 0, failed: 1, deferred: 0 }); }
  finally { deleted.mockRestore(); }
});

it("hands off every retained promotion candidate before retiring a failed row", async () => {
  const row = await pending();
  const candidate = `org/${contexts[0].organizationId}/final/${row.id}-candidate`;
  await db.update(schema.documents).set({ uploadStatus: "failed", updatedAt: new Date(Date.now() - DOCUMENT_FAILED_RETENTION_MS - MINUTE_MS),
    metadata: { promotionCandidates: [candidate, row.storageKey] },
  }).where(eq(schema.documents.id, row.id));
  await db.transaction((tx) => enqueueStorageObjectDeletion(contexts[0], tx, {
    storageProvider: provider.name, storageBucket: provider.bucket, storageKey: row.uploadStorageKey!,
  }));
  await database.transaction((tx) => retireFailedDocumentUploadsInTransaction(tx, new Date(), organizationIds));
  expect(await read(row.id)).toBeUndefined();
  expect((await queued(candidate)).length).toBeGreaterThan(0);
});
