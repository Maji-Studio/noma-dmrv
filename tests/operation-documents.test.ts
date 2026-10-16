import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, certificationSubmissions, documents, feedstocks, users } from "@/db/schema";
import { DOCUMENT_CONFIRM_DEADLINE_MS, DOCUMENT_UPLOAD_LEASE_MS, DOCUMENT_UPLOAD_MAX_LIFETIME_MS } from "@/config/documents";
import { mintDocumentUploadCapability } from "@/lib/documents/upload-capability";
import { confirmDocumentUpload } from "@/lib/documents/confirm-upload";
import { mapConfirmOutcome } from "@/lib/documents/confirm-outcome";
import { deleteDocumentApp } from "@/lib/operations/documents";
import { requestDocumentUpload } from "@/lib/operations/document-uploads";
import { runOperation } from "@/lib/operations/runner";
import { __setStorageProviderForTests } from "@/lib/storage";
import { LocalFsProvider } from "@/lib/storage/local-fs";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { cleanupDocumentUploads } from "./helpers/document-upload-cleanup";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const bytes = Buffer.from("%PDF-1.7");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const credentialId = `document-${randomUUID()}`;
const ids: string[] = [];
let fixture: LineageFixture;
let provider: LocalFsProvider;
let root: string;
beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({ id: ctx.userId, email: "document-test@example.test" }).onConflictDoNothing();
  fixture = await createLineageFixture("none");
  root = await mkdtemp(join(tmpdir(), "api-document-"));
  provider = new LocalFsProvider({ root, appUrl: "http://localhost", signingSecret: "test" });
  __setStorageProviderForTests(provider);
});
afterAll(async () => {
  __setStorageProviderForTests(null);
  if (!fixture) return;
  await cleanupDocumentUploads(ctx, ids);
  await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.credentialId, credentialId)));
  await db.delete(apiIdempotencyRecords).where(and(eq(apiIdempotencyRecords.organizationId, ctx.organizationId), eq(apiIdempotencyRecords.credentialId, credentialId)));
  if (fixture) await cleanupLineageFixture(fixture);
  if (root) await rm(root, { recursive: true, force: true });
});
const input = (extra = {}) => ({ ownerType: "feedstock", ownerId: fixture.feedstockId, documentType: "bill_of_lading", fileName: "private receipt.pdf", contentType: "application/pdf", sizeBytes: bytes.length, sha256, ...extra });
async function request(extra = {}) {
  const result = await runOperation(requestDocumentUpload, ctx, input(extra));
  ids.push(result.data.id);
  return result.data;
}
const row = async (id: string) => (await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.organizationId, ctx.organizationId))))[0];

it("stores only the pending representation and replays reordered input at pool size one", async () => {
  expect(db.$client.options.max).toBe(1);
  const idempotency = { credentialId, key: randomUUID() };
  const first = await runOperation(requestDocumentUpload, ctx, input(), { idempotency }); ids.push(first.data.id);
  expect(first.data).toMatchObject({ uploadStatus: "pending", contentType: "application/pdf", sizeBytes: bytes.length, sha256, version: 1 });
  expect(first.effect).toMatchObject({ outcome: "created", entityType: "document", entityIds: [first.data.id] });
  const saved = await row(first.data.id);
  expect(saved).toMatchObject({ uploadStatus: "pending", storageProvider: "local-fs", storageBucket: provider.bucket });
  const [stored] = await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.idempotencyKey, idempotency.key));
  expect(stored.outcome).toMatchObject({ data: first.data });
  expect(JSON.stringify(stored.outcome)).not.toContain(saved.uploadStorageKey!);
  expect(JSON.stringify(stored.outcome)).not.toContain("http");
  for (const forbidden of ["storageKey", "uploadStorageKey", "storageProvider", "storageBucket", "url", "visibility", "metadata", "createdBy"]) expect(first.data).not.toHaveProperty(forbidden);
  const replay = await runOperation(requestDocumentUpload, ctx, Object.fromEntries(Object.entries(input()).reverse()), { idempotency });
  expect(replay).toMatchObject({ replayed: true, data: first.data });
  await expect(runOperation(requestDocumentUpload, ctx, input({ description: "changed" }), { idempotency })).rejects.toMatchObject({ code: "idempotency_key_reused" });
  expect(await db.select().from(documents).where(inArray(documents.id, ids))).toHaveLength(1);
});

it.each([
  [{ documentType: "lab_report" }, "documentType"], [{ contentType: "text/plain" }, "contentType"],
  [{ contentType: "" }, "contentType"], [{ sha256: undefined }, "sha256"],
  [{ gpsLatitude: 0 }, "gpsLongitude"], [{ gpsLongitude: 0 }, "gpsLatitude"],
  [{ capturedAt: "2999-01-01T00:00:00Z" }, "capturedAt"],
] as const)("refuses an invalid declaration with a field issue", async (extra, field) => {
  await expect(request(extra)).rejects.toMatchObject({ code: "validation_failed", issues: expect.arrayContaining([expect.objectContaining({ path: [field] })]) });
});

it.each(["storageProvider", "storageBucket", "visibility", "metadata"])("refuses client %s", async (field) => {
  await expect(request({ [field]: "client" })).rejects.toMatchObject({ code: "validation_failed" });
});

it("accepts capturedAt exactly now and retains offset timestamps and GPS on PDF evidence", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-10-15T08:00:00Z");
  const now = new Date();
  try { expect(await request({ capturedAt: now.toISOString(), gpsLatitude: 0, gpsLongitude: 12 })).toMatchObject({ capturedAt: now.toISOString(), gpsLatitude: 0, gpsLongitude: 12 }); }
  finally { vi.useRealTimers(); }
});

it("hides foreign and archived owners", async () => {
  await expect(runOperation(requestDocumentUpload, { ...ctx, organizationId: "foreign-org" }, input())).rejects.toMatchObject({ code: "not_found" });
  await db.update(feedstocks).set({ archivedAt: new Date() }).where(eq(feedstocks.id, fixture.feedstockId));
  try { await expect(request()).rejects.toMatchObject({ code: "not_found" }); }
  finally { await db.update(feedstocks).set({ archivedAt: null }).where(eq(feedstocks.id, fixture.feedstockId)); }
});

it("mints the first capability and renews pending replays without changing the representation", async () => {
  const idempotency = { credentialId, key: randomUUID() };
  const { data } = await runOperation(requestDocumentUpload, ctx, input(), { idempotency }); ids.push(data.id);
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  const presign = vi.spyOn(provider, "createUploadUrl");
  try {
    const first = await mintDocumentUploadCapability(ctx, data.id);
    expect(first.upload).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/pdf" }, expiresAt: new Date(now + DOCUMENT_UPLOAD_LEASE_MS).toISOString() });
    expect(presign).toHaveBeenLastCalledWith(expect.objectContaining({ expiresInSeconds: 300 }));
    clock.mockReturnValue(now + 60_000);
    const historical = await runOperation(requestDocumentUpload, ctx, input(), { idempotency });
    expect(historical).toMatchObject({ replayed: true, data });
    const replay = await mintDocumentUploadCapability(ctx, historical.data.id);
    expect(replay.upload?.expiresAt).toBe(new Date(now + 60_000 + DOCUMENT_UPLOAD_LEASE_MS).toISOString());
    const saved = await row(data.id);
    expect(saved).toMatchObject({ version: 1, updatedAt: new Date(data.updatedAt) });
  } finally { clock.mockRestore(); presign.mockRestore(); }
});

it.each(["uploaded", "failed", "expired", "deleted", "owner_archived"] as const)("returns a %s warning without presigning", async (reason) => {
  const idempotency = { credentialId, key: randomUUID() };
  const { data } = await runOperation(requestDocumentUpload, ctx, input(), { idempotency }); ids.push(data.id);
  if (reason === "uploaded" || reason === "failed") await db.update(documents).set({ uploadStatus: reason }).where(eq(documents.id, data.id));
  if (reason === "expired") await db.update(documents).set({ createdAt: new Date(Date.now() - DOCUMENT_UPLOAD_MAX_LIFETIME_MS) }).where(eq(documents.id, data.id));
  if (reason === "deleted") await runOperation(deleteDocumentApp, ctx, { documentId: data.id, expectedVersion: data.version });
  if (reason === "owner_archived") await db.update(feedstocks).set({ archivedAt: new Date() }).where(eq(feedstocks.id, fixture.feedstockId));
  const presign = vi.spyOn(provider, "createUploadUrl");
  try {
    const historical = await runOperation(requestDocumentUpload, ctx, input(), { idempotency });
    expect(historical).toMatchObject({ replayed: true, data });
    const capability = await mintDocumentUploadCapability(ctx, historical.data.id);
    expect(capability).toMatchObject({ upload: null, warning: expect.any(String) });
    expect(capability.warning).toMatch(({ uploaded: /already uploaded/, failed: /failed/, expired: /expired/, deleted: /deleted/, owner_archived: /archived/ })[reason]);
    expect(presign).not.toHaveBeenCalled();
  } finally {
    presign.mockRestore();
    if (reason === "owner_archived") await db.update(feedstocks).set({ archivedAt: null }).where(eq(feedstocks.id, fixture.feedstockId));
  }
});

it("refuses a new request and warns on a pending capability after submission", async () => {
  const data = await request();
  const [submission] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId, version: 1, status: "submitted", payloadHash: randomUUID(), payloadSnapshot: {} }).returning();
  try {
    await expect(request()).rejects.toMatchObject({ code: "certification_locked" });
    expect(await mintDocumentUploadCapability(ctx, data.id)).toMatchObject({ upload: null, warning: expect.stringContaining("submitted Removal") });
  } finally { await db.delete(certificationSubmissions).where(eq(certificationSubmissions.id, submission.id)); }
});

const confirm = (documentId: string, extra = {}) => confirmDocumentUpload(ctx, { ownerType: "feedstock", ownerId: fixture.feedstockId, documentId, ...extra }, { deadlineAt: Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS });

it("confirms good bytes with SHA-256 and version 2, then replays without storage", async () => {
  const data = await request();
  await provider.putObject((await row(data.id)).uploadStorageKey!, bytes, "application/pdf");
  const result = mapConfirmOutcome(await confirm(data.id));
  expect(result).toMatchObject({ status: 200, data: { id: data.id, sha256, version: 2, uploadStatus: "uploaded" } });
  const read = vi.spyOn(provider, "readObjectBounded").mockRejectedValue(new Error("Storage unavailable"));
  const head = vi.spyOn(provider, "headObject").mockRejectedValue(new Error("Storage unavailable"));
  const put = vi.spyOn(provider, "putObject").mockRejectedValue(new Error("Storage unavailable"));
  try {
    expect(mapConfirmOutcome(await confirm(data.id))).toEqual(result);
    expect(read).not.toHaveBeenCalled(); expect(head).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  } finally { read.mockRestore(); head.mockRestore(); put.mockRestore(); }
});

it("commits a checksum refusal before answering 422, then replays 409 with its reason", async () => {
  const data = await request({ sha256: "0".repeat(64) });
  await provider.putObject((await row(data.id)).uploadStorageKey!, bytes, "application/pdf");
  expect(mapConfirmOutcome(await confirm(data.id))).toMatchObject({ status: 422, error: { code: "validation_failed", issues: [{ path: ["sha256"], code: "checksum" }] } });
  expect(await row(data.id)).toMatchObject({ uploadStatus: "failed", version: 2, metadata: { uploadFailure: { reason: "checksum" } } });
  const read = vi.spyOn(provider, "readObjectBounded").mockRejectedValue(new Error("Storage unavailable"));
  try {
    expect(mapConfirmOutcome(await confirm(data.id))).toMatchObject({ status: 409, error: { code: "conflict", issues: [{ code: "checksum" }] } });
    expect(read).not.toHaveBeenCalled();
  } finally { read.mockRestore(); }
});

it("hides missing, foreign and wrong-owner documents before any storage call", async () => {
  const data = await request();
  const read = vi.spyOn(provider, "readObjectBounded");
  try {
    expect(mapConfirmOutcome(await confirm(randomUUID()))).toMatchObject({ status: 404 });
    expect(mapConfirmOutcome(await confirm(data.id, { ownerId: fixture.deliveryId }))).toMatchObject({ status: 404 });
    expect(mapConfirmOutcome(await confirm(data.id, { ownerType: "delivery", ownerId: fixture.feedstockId }))).toMatchObject({ status: 404 });
    expect(mapConfirmOutcome(await confirmDocumentUpload({ ...ctx, organizationId: "foreign-org" }, { ownerType: "feedstock", ownerId: fixture.feedstockId, documentId: data.id }, { deadlineAt: Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS }))).toMatchObject({ status: 404 });
    expect(read).not.toHaveBeenCalled();
  } finally { read.mockRestore(); }
});

it("ignores any supplied idempotency option and never records a confirm key", async () => {
  const data = await request();
  await provider.putObject((await row(data.id)).uploadStorageKey!, bytes, "application/pdf");
  const keys = [randomUUID(), randomUUID()];
  const results = [];
  for (const key of keys) {
    // HTTP adapters ignore Idempotency-Key. Even an accidental extra runner
    // option at this service boundary cannot claim or store a record.
    const options = { deadlineAt: Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS, idempotency: { credentialId, key } };
    results.push(mapConfirmOutcome(await confirmDocumentUpload(ctx, { ownerType: "feedstock", ownerId: fixture.feedstockId, documentId: data.id }, options)));
  }
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ status: 200 });
  expect(await db.select().from(apiIdempotencyRecords).where(inArray(apiIdempotencyRecords.idempotencyKey, keys))).toEqual([]);
});

it("audits the committed failed transition once, with no audit for failed or gone retries", async () => {
  const data = await request({ sha256: "0".repeat(64) });
  await provider.putObject((await row(data.id)).uploadStorageKey!, bytes, "application/pdf");
  const audit = { transport: "rest" as const, requestId: randomUUID(), credentialId };
  const options = { deadlineAt: Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS, audit };
  const publicInput = { ownerType: "feedstock", ownerId: fixture.feedstockId, documentId: data.id };
  expect(mapConfirmOutcome(await confirmDocumentUpload(ctx, publicInput, options))).toMatchObject({ status: 422 });
  expect(mapConfirmOutcome(await confirmDocumentUpload(ctx, publicInput, options))).toMatchObject({ status: 409 });
  expect(mapConfirmOutcome(await confirmDocumentUpload(ctx, { ...publicInput, documentId: randomUUID() }, options))).toMatchObject({ status: 404 });
  const events = await db.select().from(activityEvents).where(and(inArray(activityEvents.source, ["rest", "mcp"]), isNotNull(activityEvents.operationId), and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.requestId, audit.requestId))));
  expect(events).toMatchObject([{ operationId: "confirm_document_upload", action: "updated", entityType: "document", entityId: data.id, versionBefore: 1, versionAfter: 2 }]);
  expect(events).toHaveLength(1);
});

it("refuses client inspection facts and keeps a missing upload pending", async () => {
  const data = await request();
  await expect(confirm(data.id, { inspectedSha256: sha256 })).rejects.toMatchObject({ code: "validation_failed" });
  await expect(confirm(data.id)).rejects.toMatchObject({ code: "conflict", retryable: true });
  expect(await row(data.id)).toMatchObject({ uploadStatus: "pending", version: 1 });
});

it("commits certification_locked when a pending owner's lineage is submitted", async () => {
  const data = await request();
  const [submission] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId, version: 1, status: "submitted", payloadHash: randomUUID(), payloadSnapshot: {} }).returning();
  const read = vi.spyOn(provider, "readObjectBounded");
  try {
    expect(mapConfirmOutcome(await confirm(data.id))).toMatchObject({ status: 409, error: { code: "certification_locked", issues: [{ path: ["ownerId"] }] } });
    expect(await row(data.id)).toMatchObject({ uploadStatus: "failed", version: 2 });
    expect(read).not.toHaveBeenCalled();
  } finally { read.mockRestore(); await db.delete(certificationSubmissions).where(eq(certificationSubmissions.id, submission.id)); }
});

it("caps a renewed lease at the upload maximum lifetime", async () => {
  const data = await request();
  const remainingLifetimeMs = 1_000;
  const now = Date.now();
  const createdAt = new Date(now - DOCUMENT_UPLOAD_MAX_LIFETIME_MS + remainingLifetimeMs);
  await db.update(documents).set({ createdAt }).where(eq(documents.id, data.id));
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    const capability = await mintDocumentUploadCapability(ctx, data.id);
    const expiresAt = new Date(createdAt.getTime() + DOCUMENT_UPLOAD_MAX_LIFETIME_MS);
    expect(capability.upload?.expiresAt).toBe(expiresAt.toISOString());
    expect((await row(data.id)).uploadExpiresAt).toEqual(expiresAt);
  } finally { clock.mockRestore(); }
});

it("requests delivery evidence", async () => {
  expect(await request({ ownerType: "delivery", ownerId: fixture.deliveryId, documentType: "delivery_receipt" })).toMatchObject({
    ownerType: "delivery", ownerId: fixture.deliveryId, documentType: "delivery_receipt", uploadStatus: "pending",
  });
});

it("requests lab sample evidence and refuses confirmation after lineage submission", async () => {
  const owner = { ownerType: "lab_sample", ownerId: fixture.sampleId };
  const data = await request({ ...owner, documentType: "lab_report" });
  expect(data).toMatchObject({ ...owner, documentType: "lab_report", uploadStatus: "pending" });
  const [submission] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId, version: 1, status: "submitted", payloadHash: randomUUID(), payloadSnapshot: {} }).returning();
  try {
    expect(mapConfirmOutcome(await confirm(data.id, owner))).toMatchObject({ status: 409, error: { code: "certification_locked", issues: [{ path: ["ownerId"] }] } });
    expect(await row(data.id)).toMatchObject({ uploadStatus: "failed", version: 2 });
  } finally { await db.delete(certificationSubmissions).where(eq(certificationSubmissions.id, submission.id)); }
});

it("hides an archived owner on confirmation at /ownerId", async () => {
  const data = await request();
  await db.update(feedstocks).set({ archivedAt: new Date() }).where(eq(feedstocks.id, fixture.feedstockId));
  const read = vi.spyOn(provider, "readObjectBounded");
  try {
    expect(mapConfirmOutcome(await confirm(data.id))).toMatchObject({ status: 404, error: { code: "not_found", issues: [{ path: ["ownerId"] }] } });
    expect(read).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
    await db.update(feedstocks).set({ archivedAt: null }).where(eq(feedstocks.id, fixture.feedstockId));
  }
});

it("answers overlapping confirms successfully and audits only the transition", async () => {
  const data = await request();
  await provider.putObject((await row(data.id)).uploadStorageKey!, bytes, "application/pdf");
  let release!: () => void;
  const bothInspected = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  const readObject = provider.readObjectBounded.bind(provider);
  const read = vi.spyOn(provider, "readObjectBounded").mockImplementation(async (args) => {
    const object = await readObject(args);
    if (++reads === 2) release();
    await bothInspected;
    return object;
  });
  const audit = { transport: "rest" as const, requestId: randomUUID(), credentialId };
  const options = { deadlineAt: Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS, audit };
  const publicInput = { ownerType: "feedstock", ownerId: fixture.feedstockId, documentId: data.id };
  try {
    const results = await Promise.all([
      confirmDocumentUpload(ctx, publicInput, options), confirmDocumentUpload(ctx, publicInput, options),
    ]);
    expect(results.map(mapConfirmOutcome)).toMatchObject([
      { status: 200, data: { id: data.id, version: 2 } }, { status: 200, data: { id: data.id, version: 2 } },
    ]);
    for (const result of results) expect(result).not.toHaveProperty("transitioned");
    const events = await db.select().from(activityEvents).where(and(inArray(activityEvents.source, ["rest", "mcp"]), isNotNull(activityEvents.operationId), and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.requestId, audit.requestId))));
    expect(events).toMatchObject([{ operationId: "confirm_document_upload", versionBefore: 1, versionAfter: 2 }]);
    expect(events).toHaveLength(1);
  } finally { read.mockRestore(); }
});
