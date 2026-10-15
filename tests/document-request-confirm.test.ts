import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, facilities, storageObjectDeletions, users } from "@/db/schema";
import { LocalFsProvider } from "@/lib/storage/local-fs";
import { ensureTestOrg, makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";
import { requestDocumentUploadInTransaction, confirmDocumentUploadInTransaction } from "@/data-access/document-writes";
import { prepareDocumentUpload } from "@/lib/documents/upload-preparation";
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: vi.fn() }));
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
const ctx = makeTestOrgContext();
const documentIds: string[] = [];
let provider: LocalFsProvider; let facilityId: string; let root: string;
const bytes = Buffer.from("%PDF-1.7");
beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({ id: ctx.userId, email: "document-test@example.test" }).onConflictDoNothing();
  root = await mkdtemp(join(tmpdir(), "document-confirm-"));
  provider = new LocalFsProvider({ root, appUrl: "http://localhost", signingSecret: "test" });
  const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: ctx.organizationId, code: `DOC-${Date.now()}`, name: "Document test", timezone: "UTC" }).returning(); facilityId = facility.id;
});
afterAll(async () => {
  await cleanupDocumentUploads(ctx, documentIds);
  if (facilityId) {
    await db.delete(documents).where(and(eq(documents.organizationId, ctx.organizationId), eq(documents.entityId, facilityId)));
    await db.delete(facilities).where(eq(facilities.id, facilityId));
  }
  if (root) await rm(root, { recursive: true, force: true });
});
const request = async (extra = {}) => { const row = await db.transaction((tx) => requestDocumentUploadInTransaction(ctx, tx, { entityType: "facility", entityId: facilityId, documentType: "pdf", fileName: "private report.pdf", contentType: "application/pdf", sizeBytes: bytes.length, storageProvider: provider.name, storageBucket: provider.bucket, ...extra })); documentIds.push(row.id); return row; };
it("creates a leased upload then promotes verified bytes and defers upload deletion", async () => {
  const row = await request();
  expect(row).toMatchObject({ version: 1, uploadStatus: "pending", uploadStorageKey: row.storageKey });
  expect(row.storageKey).toMatch(/\/uploads\//); expect(row.storageKey).not.toContain("private"); expect(row.uploadExpiresAt).toBeInstanceOf(Date);
  await expect(prepareDocumentUpload(ctx, row.id, provider)).rejects.toMatchObject({ code: "conflict", retryable: true });
  await provider.putObject(row.storageKey!, bytes, "application/pdf");
  const prepared = await prepareDocumentUpload(ctx, row.id, provider);
  if (prepared.kind !== "prepared") throw new Error("Expected pending upload");
  const outcome = await db.transaction((tx) => confirmDocumentUploadInTransaction(ctx, tx, prepared.facts));
  expect(outcome.kind).toBe("uploaded");
  const [saved] = await db.select().from(documents).where(eq(documents.id, row.id));
  expect(saved).toMatchObject({ uploadStatus: "uploaded", version: 2, fileSizeBytes: bytes.length, mimeType: "application/pdf" });
  expect(saved.storageKey).toContain(saved.checksumSha256);
  const [queued] = await db.select().from(storageObjectDeletions).where(eq(storageObjectDeletions.storageKey, row.storageKey!));
  expect(queued.notBefore!.getTime()).toBeGreaterThan(row.uploadExpiresAt!.getTime());
  expect((await prepareDocumentUpload(ctx, row.id, provider)).kind).toBe("uploaded");
});
it.each(["size", "type", "checksum"])("commits a %s refusal", async (reason) => {
  const row = await request(reason === "checksum" ? { sha256: "0".repeat(64) } : {});
  await provider.putObject(row.storageKey!, reason === "size" ? Buffer.from("x") : reason === "type" ? Buffer.from("not pdf!") : bytes, "application/pdf");
  const prepared = await prepareDocumentUpload(ctx, row.id, provider);
  if (prepared.kind !== "prepared") throw new Error("Expected pending upload");
  expect(await db.transaction((tx) => confirmDocumentUploadInTransaction(ctx, tx, prepared.facts))).toMatchObject({ kind: "refused", reason, pointer: ({ size: "/sizeBytes", type: "/contentType", checksum: "/sha256" })[reason as "size"] });
  const [saved] = await db.select().from(documents).where(eq(documents.id, row.id));
  expect(saved).toMatchObject({ uploadStatus: "failed", version: 2, metadata: { uploadFailure: { reason } } });
  await expect(prepareDocumentUpload(ctx, row.id, provider)).rejects.toMatchObject({ code: "conflict" });
});
it("rejects archived request and confirm but permits delete; rejects foreign owners", async () => {
  const row = await request();
  await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, facilityId));
  try {
    await expect(request()).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["facilityId"] }] });
    await expect(prepareDocumentUpload(ctx, row.id, provider)).rejects.toMatchObject({ code: "not_found" });
    const { deleteDocumentInTransaction } = await import("@/data-access/document-mutations");
    expect(await db.transaction((tx) => deleteDocumentInTransaction(ctx, tx, { documentId: row.id, expectedVersion: row.version }))).toMatchObject({ id: row.id });
    await expect(db.transaction((tx) => requestDocumentUploadInTransaction({ ...ctx, organizationId: "foreign-org" }, tx, { entityType: "facility", entityId: facilityId, documentType: "pdf", fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8, storageProvider: provider.name, storageBucket: provider.bucket }))).rejects.toMatchObject({ code: "not_found" });
  } finally { await db.update(facilities).set({ archivedAt: null }).where(eq(facilities.id, facilityId)); }
});
it("replays uploaded rows during storage outage without reading objects", async () => {
  const row = await request(); await provider.putObject(row.storageKey!, bytes, "application/pdf");
  const result = await prepareDocumentUpload(ctx, row.id, provider); if (result.kind !== "prepared") throw new Error("Expected pending");
  await db.transaction((tx) => confirmDocumentUploadInTransaction(ctx, tx, result.facts));
  const spy = vi.spyOn(provider, "readObjectBounded").mockRejectedValue(new Error("Storage unavailable"));
  try { expect((await prepareDocumentUpload(ctx, row.id, provider)).kind).toBe("uploaded"); expect(spy).not.toHaveBeenCalled(); }
  finally { spy.mockRestore(); }
});
it("leaves a pending row retryable after storage cancellation", async () => {
  const row = await request();
  const spy = vi.spyOn(provider, "readObjectBounded").mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
  try {
    await expect(prepareDocumentUpload(ctx, row.id, provider)).rejects.toMatchObject({ code: "deadline_exceeded", retryable: true });
    const [saved] = await db.select().from(documents).where(eq(documents.id, row.id)); expect(saved).toMatchObject({ uploadStatus: "pending", version: 1 });
  } finally { spy.mockRestore(); }
});
it("enforces the exact upload cap and MIME allowlist before inserting", async () => {
  const { DOCUMENT_UPLOAD_MAX_BYTES } = await import("@/lib/documents/upload-policy");
  await expect(request({ sizeBytes: DOCUMENT_UPLOAD_MAX_BYTES + 1 })).rejects.toThrow();
  await expect(request({ sizeBytes: 0 })).rejects.toThrow();
  await expect(request({ contentType: "text/html" })).rejects.toMatchObject({ code: "validation_failed" });
  expect((await request({ sizeBytes: DOCUMENT_UPLOAD_MAX_BYTES })).fileSizeBytes).toBe(DOCUMENT_UPLOAD_MAX_BYTES);
});

it.each(["", "text/plain"])("confirms a GIS upload through the local presigned PUT route (%j)", async (contentType) => {
  const { env } = await import("@/config/env");
  const { NextRequest } = await import("next/server");
  const { PUT } = await import("@/app/api/storage-local/[...key]/route");
  const { __setStorageProviderForTests } = await import("@/lib/storage");
  const { confirmUpload } = await import("@/fn/documents");
  const { requireOrgContext } = await import("@/lib/auth/server");
  vi.mocked(requireOrgContext).mockResolvedValue(ctx);
  const previous = { STORAGE_PROVIDER: env.STORAGE_PROVIDER, STORAGE_LOCAL_FS_ROOT: env.STORAGE_LOCAL_FS_ROOT, STORAGE_SIGNING_SECRET: env.STORAGE_SIGNING_SECRET };
  Object.assign(env, { STORAGE_PROVIDER: "local-fs", STORAGE_LOCAL_FS_ROOT: root, STORAGE_SIGNING_SECRET: "test" });
  __setStorageProviderForTests(provider);
  try {
    const body = '{"type":"FeatureCollection","features":[]}';
    const row = await request({ documentType: "gis_boundary", contentType, fileName: "boundary.geojson", sizeBytes: Buffer.byteLength(body) });
    const signed = await provider.createUploadUrl({ key: row.uploadStorageKey!, contentType, maxBytes: Buffer.byteLength(body) });
    const response = await PUT(new NextRequest(signed.url, { method: "PUT", headers: signed.headers, body }), { params: Promise.resolve({ key: row.uploadStorageKey!.split("/") }) });
    expect(response.status).toBe(204);
    expect((await provider.readObjectBounded({ key: row.uploadStorageKey!, maxBytes: Buffer.byteLength(body) }))?.contentType).toBe(contentType);
    expect(await confirmUpload({ documentId: row.id })).toMatchObject({ success: true, data: { uploadStatus: "uploaded" } });
  } finally { Object.assign(env, previous); __setStorageProviderForTests(null); }
});
it("surfaces a committed refusal through the real action and runner", async () => {
  const { __setStorageProviderForTests } = await import("@/lib/storage");
  const { confirmUpload } = await import("@/fn/documents");
  const { requireOrgContext } = await import("@/lib/auth/server");
  vi.mocked(requireOrgContext).mockResolvedValue(ctx);
  __setStorageProviderForTests(provider);
  try {
    const row = await request();
    await provider.putObject(row.uploadStorageKey!, Buffer.from("not pdf!"), "application/pdf");
    expect(await confirmUpload({ documentId: row.id })).toMatchObject({ success: false, code: "validation_failed", issues: [{ path: ["contentType"] }] });
    const [saved] = await db.select().from(documents).where(eq(documents.id, row.id));
    expect(saved).toMatchObject({ uploadStatus: "failed", version: 2 });
  } finally { __setStorageProviderForTests(null); }
});
