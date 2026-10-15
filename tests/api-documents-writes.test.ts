/** Real REST routes, credentials, Postgres and local storage. Needs the supervisor. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PUT as putLocal } from "@/app/api/storage-local/[...key]/route";
import { __setStorageProviderForTests } from "@/lib/storage";
import { LocalFsProvider } from "@/lib/storage/local-fs";
import { documentRepresentationSchema } from "@/lib/representations/documents";
import { db } from "@/db";
import { apiRateLimitBuckets, documents, feedstocks, members } from "@/db/schema";
import { archiveFacility } from "@/data-access/facilities";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { deliveries } from "@/db/schema";
import { GET as getApplicationDocument } from "@/app/api/v1/applications/[idOrCode]/documents/[documentId]/route";
import { API_RATE_LIMITS } from "@/config/api-rate-limits";
import { DOCUMENT_CONFIRM_RETRY_AFTER_SECONDS } from "@/config/documents";
import { API_BODY_MAX_BYTES } from "@/config/api-rest";
import { guardApiMethod } from "@/lib/api/method-not-allowed";
import { UPLOAD_UNAVAILABLE_WARNINGS } from "@/lib/documents/upload-capability";
import { API_DOCUMENT_OWNERS } from "@/lib/documents/api-owners";
import { GET as getFeedstock, DELETE as deleteFeedstock } from "@/app/api/v1/feedstocks/[idOrCode]/route";
import { GET as getDeliveryDocument } from "@/app/api/v1/deliveries/[idOrCode]/documents/[documentId]/route";
import { lookupProblem } from "./helpers/api-lookups";
import { insertReadDelivery, readRequest, READ_TIMEOUT_MS, UNKNOWN_READ_ID } from "./helpers/api-order-read-fixture";
import { callDocumentWrite, createApiDocumentWriteFixture, removeApiDocumentWriteFixture,
  documentInput, documentRows, documentRecords, documentAudits, submitDocumentDelivery,
  DOCUMENT_BYTES, DOCUMENT_SHA256, type ApiDocumentWriteFixture } from "./helpers/api-document-write-fixture";

const storage = vi.hoisted(() => ({ root: "", secret: "document-write-test-signing-secret", writesDisabled: false }));
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, STORAGE_PROVIDER: "local-fs",
    STORAGE_SIGNING_SECRET: storage.secret, get STORAGE_LOCAL_FS_ROOT() { return storage.root; },
    get API_WRITES_DISABLED() { return storage.writesDisabled; } } };
});
let a: ApiDocumentWriteFixture;
let b: ApiDocumentWriteFixture;
let provider: LocalFsProvider;
const bucketKeys: string[] = [];
async function problem(response: Response, status: number, code: string, pointer?: string) {
  const body = await lookupProblem(response, status, code);
  if (pointer) expect(body.errors).toContainEqual(expect.objectContaining({ pointer }));
  return body;
}
beforeEach(async () => {
  storage.writesDisabled = false;
  a = await createApiDocumentWriteFixture(); b = await createApiDocumentWriteFixture();
  storage.root = await mkdtemp(join(tmpdir(), "document-writes-"));
  provider = new LocalFsProvider({ root: storage.root, appUrl: "http://localhost:3100", signingSecret: storage.secret });
  __setStorageProviderForTests(provider);
}, READ_TIMEOUT_MS);
afterEach(async () => {
  vi.restoreAllMocks(); storage.writesDisabled = false;
  vi.unstubAllEnvs();
  if (bucketKeys.length) await db.delete(apiRateLimitBuckets).where(inArray(apiRateLimitBuckets.bucketKey, bucketKeys.splice(0)));
  __setStorageProviderForTests(null);
  for (const f of [a, b]) if (f) await removeApiDocumentWriteFixture(f);
  if (storage.root) await rm(storage.root, { recursive: true, force: true });
}, READ_TIMEOUT_MS);
async function put(upload: { url: string; headers: Record<string, string> }, bytes = DOCUMENT_BYTES) {
  const url = new URL(upload.url);
  const key = url.pathname.replace("/api/storage-local/", "").split("/").map(decodeURIComponent);
  const response = await putLocal(new NextRequest(upload.url, { method: "PUT", headers: upload.headers, body: new Uint8Array(bytes) }), { params: Promise.resolve({ key }) });
  expect(response.status).toBe(204);
}
const request = (options: Parameters<typeof callDocumentWrite>[3] = {}) => callDocumentWrite(a, "delivery", "request", options);
const confirm = (documentId: string, options: Parameters<typeof callDocumentWrite>[3] = {}) => callDocumentWrite(a, "delivery", "confirm", { documentId, ...options });
async function pending(options: Parameters<typeof callDocumentWrite>[3] = {}) {
  const response = await request(options);
  expect(response.status).toBe(201);
  return { response, ...await response.json() };
}
async function read(documentId: string) {
  return getDeliveryDocument(readRequest(`/deliveries/${a.owners.delivery.id}/documents/${documentId}`, a.writeKey),
    { params: Promise.resolve({ idOrCode: a.owners.delivery.id, documentId }) });
}
describe("document REST writes", { timeout: READ_TIMEOUT_MS }, () => {
  it("requires application write scope and accepts only photo and PDF declarations", async () => {
    const credential = (await createApiKey(a.ctx, { name: "Application documents", expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
      scopes: ["applications:read", "applications:write"] })).key;
    const deliveryCredential = (await createApiKey(a.ctx, { name: "Delivery only", expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
      scopes: ["deliveries:write"] })).key;
    await problem(await callDocumentWrite(a, "application", "request", { credential: deliveryCredential }), 403, "missing_scope");
    await problem(await callDocumentWrite(a, "application", "confirm", { credential: deliveryCredential, documentId: UNKNOWN_READ_ID }), 403, "missing_scope");
    for (const documentType of ["gis_boundary", "weighbridge_ticket", "affidavit"]) {
      await problem(await callDocumentWrite(a, "application", "request", { credential, body: documentInput("application", { documentType }) }), 422, "validation_failed");
    }
    for (const metadata of ["evidenceRole", "logbookEvidenceType"]) {
      await problem(await callDocumentWrite(a, "application", "request", { credential, body: documentInput("application", { [metadata]: "hidden" }) }), 422, "validation_failed");
    }
    const requested = await callDocumentWrite(a, "application", "request", { credential });
    expect(requested.status).toBe(201);
    const body = await requested.json();
    await put(body.upload);
    expect((await callDocumentWrite(a, "application", "confirm", { credential, documentId: body.data.id })).status).toBe(200);
    const read = await getApplicationDocument(readRequest(`/applications/${a.owners.application.id}/documents/${body.data.id}`, credential),
      { params: Promise.resolve({ idOrCode: a.owners.application.id, documentId: body.data.id }) });
    expect((await read.json()).data).toMatchObject({ ownerType: "application", ownerId: a.owners.application.id, documentType: "pdf", sha256: DOCUMENT_SHA256 });
  });

  it("refuses application uploads and pending confirmation after delivery or facility archive", async () => {
    const requested = await callDocumentWrite(a, "application", "request");
    expect(requested.status).toBe(201);
    const body = await requested.json();
    await put(body.upload);
    await db.update(deliveries).set({ archivedAt: new Date() }).where(eq(deliveries.id, a.owners.delivery.id));
    await problem(await callDocumentWrite(a, "application", "request"), 404, "not_found");
    await problem(await callDocumentWrite(a, "application", "confirm", { documentId: body.data.id }), 404, "not_found");
    await db.update(deliveries).set({ archivedAt: null }).where(eq(deliveries.id, a.owners.delivery.id));
    await archiveFacility(a.ctx, a.facility.id, a.facility.version);
    await problem(await callDocumentWrite(a, "application", "request"), 404, "not_found");
    await problem(await callDocumentWrite(a, "application", "confirm", { documentId: body.data.id }), 404, "not_found");
  });

  it("refuses application document writes once its lineage is submitted", async () => {
    const requested = await callDocumentWrite(a, "application", "request");
    expect(requested.status).toBe(201);
    const body = await requested.json();
    await put(body.upload);
    await submitDocumentDelivery(a, a.owners.application.id);
    await problem(await callDocumentWrite(a, "application", "request"), 409, "certification_locked");
    await problem(await callDocumentWrite(a, "application", "confirm", { documentId: body.data.id }), 409, "certification_locked");
  });

  it.each(["feedstock", "delivery", "lab_sample", "application"] as const)("requests, uploads and confirms %s evidence", async owner => {
    const response = await callDocumentWrite(a, owner, "request", { id: a.owners[owner].code });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(documentRepresentationSchema.parse(body.data)).toEqual(body.data);
    expect(body.data).toMatchObject({ ownerType: owner, ownerId: a.owners[owner].id, version: 1, uploadStatus: "pending" });
    const path = API_DOCUMENT_OWNERS[owner].path;
    expect(response.headers.get("location")).toBe(`/api/v1/${path}/${a.owners[owner].id}/documents/${body.data.id}`);
    expect(response.headers.get("etag")).toBe('"1.1"');
    expect(body.upload).toMatchObject({ method: "PUT", headers: { "Content-Type": "application/pdf" }, expiresAt: expect.any(String) });
    expect(body.upload.url).not.toContain(a.writeKey);
    if (owner === "delivery") {
      const get = await read(body.data.id);
      expect(get.headers.get("etag")).toBe(response.headers.get("etag"));
      expect((await get.json()).data).toEqual(body.data);
    }
    await put(body.upload);
    const confirmed = await callDocumentWrite(a, owner, "confirm", { documentId: body.data.id });
    expect(confirmed.status).toBe(200);
    expect(confirmed.headers.get("etag")).toBe('"2.1"');
    expect((await confirmed.json()).data).toMatchObject({ id: body.data.id, sha256: DOCUMENT_SHA256, uploadStatus: "uploaded", version: 2 });
    if (owner === "delivery") {
      const get = await read(body.data.id);
      expect(get.headers.get("etag")).toBe(confirmed.headers.get("etag"));
      expect((await get.json()).data).toMatchObject({ version: 2, sha256: DOCUMENT_SHA256 });
    }
  });

  it("requires a request key and refuses query dry runs without saving", async () => {
    await problem(await request({ key: null }), 400, "idempotency_key_required");
    await problem(await request({ query: "?dryRun=true" }), 422, "validation_failed");
    await problem(await confirm(UNKNOWN_READ_ID, { query: "?dryRun=true" }), 422, "validation_failed");
    expect(await documentRows(a)).toEqual([]);
    expect(await documentRecords(a)).toEqual([]);
    expect(await documentAudits(a)).toEqual([]);
  });

  it("refuses a malformed request key without saving", async () => {
    await problem(await request({ key: "invalid key" }), 400, "idempotency_key_invalid");
    expect(await documentRows(a)).toEqual([]);
    expect(await documentRecords(a)).toEqual([]);
    expect(await documentAudits(a)).toEqual([]);
  });

  it("ignores the Dry-Run request header on request and confirm", async () => {
    const headers = { "Dry-Run": "true" };
    const first = await pending({ headers });
    await put(first.upload);
    expect((await confirm(first.data.id, { headers })).status).toBe(200);
    expect(await documentRows(a)).toMatchObject([{ uploadStatus: "uploaded", version: 2 }]);
  });

  it("replays stored data with a later capability, then omits the link after confirm", async () => {
    const key = randomUUID();
    const first = await pending({ key, id: a.owners.delivery.code });
    const now = Date.now();
    const replayDelayMs = 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + replayDelayMs);
    const replay = await request({ key, id: a.owners.delivery.id.toUpperCase(), body: Object.fromEntries(Object.entries(documentInput()).reverse()) });
    clock.mockRestore();
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(first.response.headers.get("etag"));
    expect(replay.headers.get("location")).toBe(first.response.headers.get("location"));
    const body = await replay.json();
    expect(body.data).toEqual(first.data);
    expect(body.upload.url).not.toBe(first.upload.url);
    expect(new Date(body.upload.expiresAt).getTime()).toBeGreaterThan(new Date(first.upload.expiresAt).getTime());
    await put(body.upload);
    expect((await confirm(first.data.id)).status).toBe(200);
    const uploadedReplay = await request({ key });
    expect(uploadedReplay.status).toBe(201);
    expect(uploadedReplay.headers.get("idempotent-replayed")).toBe("true");
    expect(await uploadedReplay.json()).toEqual({ data: first.data, upload: null, warnings: [UPLOAD_UNAVAILABLE_WARNINGS.uploaded] });
    const records = await documentRecords(a);
    expect(records).toHaveLength(1);
    expect(records[0].outcome).toMatchObject({ data: first.data });
    expect(records[0].outcome).not.toHaveProperty("upload");
    expect(JSON.stringify(records[0].outcome)).not.toContain("http");
    expect(await documentAudits(a)).toHaveLength(2);
  });

  it("replays after facility archive with the historical data and an archived warning", async () => {
    const key = randomUUID();
    const first = await pending({ key });
    await archiveFacility(a.ctx, a.facility.id, a.facility.version);
    const replay = await request({ key });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.json()).toEqual({ data: first.data, upload: null, warnings: [UPLOAD_UNAVAILABLE_WARNINGS.owner_archived] });
    await problem(await request(), 404, "not_found", "/ownerId");
  });

  it("replays the stored upload request after the feedstock is deleted through REST", async () => {
    const [feedstock] = await db.insert(feedstocks).values({ ...a.owners.feedstock, id: randomUUID(), code: `FS-DOC-DELETE-${a.tag}` }).returning();
    const id = feedstock.id;
    const key = randomUUID();
    const body = documentInput("feedstock");
    const first = await callDocumentWrite(a, "feedstock", "request", { id, key, body });
    expect(first.status).toBe(201);
    const original = await first.json();
    const path = `/feedstocks/${id}`;
    const params = { params: Promise.resolve({ idOrCode: id }) };
    const current = await getFeedstock(readRequest(path, a.writeKey), params);
    expect(current.status).toBe(200);
    const deleted = await deleteFeedstock(new Request(`http://localhost:3100/api/v1${path}`, {
      method: "DELETE", headers: { authorization: `Bearer ${a.writeKey}`, "If-Match": current.headers.get("etag")! },
    }), params);
    expect(deleted.status).toBe(204);
    const replay = await callDocumentWrite(a, "feedstock", "request", { id: id.toUpperCase(), key, body });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.json()).toEqual({ data: original.data, upload: null, warnings: [UPLOAD_UNAVAILABLE_WARNINGS.deleted] });
    await problem(await callDocumentWrite(a, "feedstock", "confirm", { id, documentId: original.data.id }), 404, "not_found", "/documentId");
    await problem(await callDocumentWrite(a, "feedstock", "request", { id, body }), 404, "not_found", "/ownerId");
  });

  it("refuses changed input under the same key without another document or audit", async () => {
    const key = randomUUID();
    await pending({ key });
    await problem(await request({ key, body: documentInput("delivery", { description: "Changed" }) }), 422, "idempotency_key_reused");
    expect(await documentRows(a)).toHaveLength(1);
    expect(await documentRecords(a)).toHaveLength(1);
    expect(await documentAudits(a)).toHaveLength(1);
  });

  it("replays a deleted document as the historical success with no link", async () => {
    const key = randomUUID();
    const first = await pending({ key });
    await db.delete(documents).where(and(eq(documents.organizationId, a.ctx.organizationId), eq(documents.id, first.data.id)));
    const replay = await request({ key });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.json()).toEqual({ data: first.data, upload: null, warnings: [UPLOAD_UNAVAILABLE_WARNINGS.deleted] });
    expect(await documentAudits(a)).toHaveLength(1);
  });

  it.each(["unknown", "ownerType", "ownerId", "storageProvider", "storageBucket", "storageKey", "uploadStorageKey", "visibility", "metadata"])("refuses client %s and keeps its key unclaimed", async field => {
    const key = randomUUID();
    const refusal = await problem(await request({ key, body: documentInput("delivery", { [field]: "client" }) }), 422, "validation_failed", `/${field}`);
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: `/${field}`, code: "unknown_field" }));
    expect(await documentRows(a)).toEqual([]);
    expect(await documentRecords(a)).toEqual([]);
    expect(await documentAudits(a)).toEqual([]);
    expect((await request({ key })).status).toBe(201);
  });

  it("refuses a disallowed document type and a missing checksum at their field pointers", async () => {
    await problem(await request({ body: documentInput("delivery", { documentType: "lab_report" }) }), 422, "validation_failed", "/documentType");
    await problem(await request({ body: documentInput("delivery", { sha256: undefined }) }), 422, "validation_failed", "/sha256");
    expect(await documentRows(a)).toEqual([]);
    expect(await documentRecords(a)).toEqual([]);
  });

  it("uses the shared JSON cap for upload requests and confirm commands", async () => {
    const oversized = { description: "a".repeat(API_BODY_MAX_BYTES) };
    await problem(await request({ body: oversized }), 413, "payload_too_large");
    await problem(await confirm(UNKNOWN_READ_ID, { body: oversized }), 413, "payload_too_large");
    expect(await documentRows(a)).toEqual([]);
  });

  it.each(["feedstock", "delivery", "lab_sample", "application"] as const)("checks %s write permission before foreign or unknown owner existence", async owner => {
    for (const id of [UNKNOWN_READ_ID, b.owners[owner].id]) {
      for (const kind of ["request", "confirm"] as const) {
        await problem(await callDocumentWrite(a, owner, kind, { id, documentId: UNKNOWN_READ_ID, credential: a.key }), 403, "missing_scope");
        await problem(await callDocumentWrite(a, owner, kind, { id, documentId: UNKNOWN_READ_ID }), 404, "not_found");
      }
    }
    expect(await documentRows(a)).toEqual([]);
    expect(await documentRecords(a)).toEqual([]);
  });

  it("refuses a credential whose owner became a member before resolving any path", async () => {
    await db.update(members).set({ role: "member" }).where(and(eq(members.organizationId, a.ctx.organizationId), eq(members.userId, a.ctx.userId)));
    // Credential revocation is the established auth contract and precedes scope admission.
    await problem(await request({ id: UNKNOWN_READ_ID }), 401, "credential_owner_removed");
    await problem(await confirm(UNKNOWN_READ_ID, { id: UNKNOWN_READ_ID }), 401, "credential_owner_removed");
    expect(await documentRows(a)).toEqual([]);
  });

  it("keeps a missing upload pending and retryable, then accepts bytes on retry", async () => {
    const first = await pending();
    const response = await confirm(first.data.id);
    expect(response.headers.get("retry-after")).toBe(String(DOCUMENT_CONFIRM_RETRY_AFTER_SECONDS));
    expect(await problem(response, 409, "conflict")).toMatchObject({ retryable: true });
    expect(await documentRows(a)).toMatchObject([{ uploadStatus: "pending", version: 1 }]);
    expect(await documentAudits(a)).toHaveLength(1);
    await put(first.upload);
    expect((await confirm(first.data.id)).status).toBe(200);
  });

  it("ignores request keys and If-Match on confirm and audits only the successful transition", async () => {
    const first = await pending();
    await put(first.upload);
    const key = randomUUID();
    const headers = { "If-Match": "malformed" };
    const confirmed = await confirm(first.data.id.toUpperCase(), { key, headers, body: {} });
    expect(confirmed.status).toBe(200);
    const original = await confirmed.json();
    const storageRead = vi.spyOn(provider, "readObjectBounded").mockRejectedValue(new Error("Storage unavailable"));
    const storageHead = vi.spyOn(provider, "headObject").mockRejectedValue(new Error("Storage unavailable"));
    const storagePut = vi.spyOn(provider, "putObject").mockRejectedValue(new Error("Storage unavailable"));
    const repeated = await confirm(first.data.id, { key, headers });
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual(original);
    expect(repeated.headers.get("etag")).toBe(confirmed.headers.get("etag"));
    expect(repeated.headers.has("idempotent-replayed")).toBe(false);
    expect((await confirm(first.data.id, { key: "", headers })).status).toBe(200);
    for (const spy of [storageRead, storageHead, storagePut]) expect(spy).not.toHaveBeenCalled();
    const audits = await documentAudits(a);
    expect(audits).toHaveLength(2);
    expect(audits.filter(event => event.operationId === "confirm_document_upload")).toMatchObject([{ outcomeCode: "updated", versionBefore: 1, versionAfter: 2 }]);
    const records = await documentRecords(a);
    expect(records).toHaveLength(1);
    expect(records.some(record => record.idempotencyKey === key)).toBe(false);
  });

  it.each([null, [], "", 1, { sha256: DOCUMENT_SHA256 }, { ownerId: UNKNOWN_READ_ID }])("refuses a nonempty or nonobject confirm body", async body => {
    const first = await pending();
    await problem(await confirm(first.data.id, { body }), 422, "validation_failed");
    expect(await documentRows(a)).toMatchObject([{ uploadStatus: "pending", version: 1 }]);
    expect(await documentAudits(a)).toHaveLength(1);
  });

  it("fails wrong bytes at /sha256 and returns the stored reason on repeats", async () => {
    const first = await pending({ body: documentInput("delivery", { sha256: "0".repeat(64) }) });
    await put(first.upload);
    await problem(await confirm(first.data.id), 422, "validation_failed", "/sha256");
    expect(await documentRows(a)).toMatchObject([{ uploadStatus: "failed", version: 2 }]);
    const storageRead = vi.spyOn(provider, "readObjectBounded");
    const failure = await problem(await confirm(first.data.id), 409, "conflict", "/documentId");
    expect(failure.errors).toContainEqual(expect.objectContaining({ code: "checksum" }));
    expect(storageRead).not.toHaveBeenCalled();
    expect(await documentAudits(a)).toHaveLength(2);
  });

  it("hides documents under another owner, owner type or organization before storage", async () => {
    const first = await pending();
    const foreign = await callDocumentWrite(b, "delivery", "request");
    const foreignData = (await foreign.json()).data;
    const storageRead = vi.spyOn(provider, "readObjectBounded");
    const anotherOwner = await insertReadDelivery(a, a.owners.delivery.orderId, 10);
    await problem(await confirm(first.data.id, { id: anotherOwner.id }), 404, "not_found", "/documentId");
    await problem(await confirm(first.data.id, { id: a.owners.feedstock.id }), 404, "not_found");
    await problem(await callDocumentWrite(a, "feedstock", "confirm", { documentId: first.data.id }), 404, "not_found", "/documentId");
    await problem(await confirm(foreignData.id), 404, "not_found", "/documentId");
    await problem(await confirm(UNKNOWN_READ_ID), 404, "not_found", "/documentId");
    expect(storageRead).not.toHaveBeenCalled();
    expect(await documentAudits(a)).toHaveLength(1);
  });

  it("refuses new uploads after submission and commits failure when submission precedes confirm", async () => {
    const first = await pending();
    await submitDocumentDelivery(a);
    await problem(await request(), 409, "certification_locked", "/ownerId");
    const storageRead = vi.spyOn(provider, "readObjectBounded");
    await problem(await confirm(first.data.id), 409, "certification_locked", "/ownerId");
    expect(await documentRows(a)).toMatchObject([{ uploadStatus: "failed", version: 2 }]);
    expect(storageRead).not.toHaveBeenCalled();
    const repeated = await problem(await confirm(first.data.id), 409, "conflict");
    expect(repeated.errors).toContainEqual(expect.objectContaining({ code: "certification_locked" }));
    expect(await documentRecords(a)).toHaveLength(1);
    expect(await documentAudits(a)).toHaveLength(2);
  });

  it("returns a retryable deadline problem without failing the pending row", async () => {
    const first = await pending();
    vi.spyOn(provider, "readObjectBounded").mockRejectedValue(new DOMException("Read aborted", "AbortError"));
    expect(await problem(await confirm(first.data.id), 500, "deadline_exceeded")).toMatchObject({ retryable: true });
    expect(await documentRows(a)).toMatchObject([{ uploadStatus: "pending", version: 1 }]);
    expect(await documentAudits(a)).toHaveLength(1);
  });

  it("respects the write kill switch before lookup or storage on both commands", async () => {
    storage.writesDisabled = true;
    await problem(await request({ id: UNKNOWN_READ_ID }), 503, "api_writes_disabled");
    await problem(await confirm(UNKNOWN_READ_ID), 503, "api_writes_disabled");
    expect(await documentRows(a)).toEqual([]);
    expect(await documentRecords(a)).toEqual([]);
    expect(await documentAudits(a)).toEqual([]);
  });

  it("charges request, replay and confirm against write buckets and refuses an exhausted budget", async () => {
    const key = randomUUID();
    bucketKeys.push(`credential:${a.credentialId}:write`, `organization:${a.ctx.organizationId}:write`);
    // A future refill instant freezes replenishment without replacing the real limiter.
    await db.insert(apiRateLimitBuckets).values(bucketKeys.map(bucketKey => ({
      bucketKey, tokens: API_RATE_LIMITS[bucketKey.startsWith("credential:") ? "credential" : "organization"].write,
      refilledAt: new Date(Date.now() + READ_TIMEOUT_MS),
    })));
    vi.stubEnv("DISABLE_RATE_LIMIT", "false");
    const first = await pending({ key });
    expect((await request({ key })).headers.get("idempotent-replayed")).toBe("true");
    await problem(await confirm(first.data.id), 409, "conflict");
    const charged = await db.select().from(apiRateLimitBuckets).where(inArray(apiRateLimitBuckets.bucketKey, bucketKeys));
    expect(charged).toHaveLength(2);
    const requestCount = 3;
    for (const bucket of charged) {
      const kind = bucket.bucketKey.startsWith("credential:") ? "credential" : "organization";
      expect(bucket.tokens).toBe(API_RATE_LIMITS[kind].write - requestCount);
    }
    await db.update(apiRateLimitBuckets).set({ tokens: 0, refilledAt: new Date(Date.now() + READ_TIMEOUT_MS) }).where(inArray(apiRateLimitBuckets.bucketKey, bucketKeys));
    for (const send of [() => request(), () => confirm(first.data.id)]) {
      const response = await send();
      expect(response.headers.get("retry-after")).toBeTruthy();
      await problem(response, 429, "rate_limited");
    }
    expect(await documentRows(a)).toHaveLength(1);
    expect(await documentAudits(a)).toHaveLength(1);
  });

  it.each(["feedstocks", "deliveries", "lab-samples", "applications"])("keeps DELETE, PATCH and PUT unsupported on every %s document path", async owner => {
    for (const suffix of ["", `/${UNKNOWN_READ_ID}`, `/${UNKNOWN_READ_ID}/content`, `/${UNKNOWN_READ_ID}/confirm`]) {
      for (const method of ["DELETE", "PATCH", "PUT"]) {
        const path = `/api/v1/${owner}/${UNKNOWN_READ_ID}/documents${suffix}`;
        const response = await guardApiMethod(new Request(`http://localhost:3100${path}`, { method, headers: { authorization: `Bearer ${a.writeKey}` } }));
        expect(response?.status).toBe(405);
        const allow = suffix.endsWith("confirm") ? "OPTIONS, POST" : suffix ? "GET, HEAD, OPTIONS" : "GET, HEAD, OPTIONS, POST";
        expect(response?.headers.get("allow")).toBe(allow);
      }
    }
  });
});

it.each(["confirm", "delete"] as const)("returns the terminal outcome when %s commits before candidate registration", async (winner) => {
  const first = await pending();
  await put(first.upload);
  let entered!: () => void;
  let release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const readObject = provider.readObjectBounded.bind(provider);
  vi.spyOn(provider, "readObjectBounded").mockImplementationOnce(async (input) => {
    const object = await readObject(input);
    entered();
    await resume;
    return object;
  });
  const putObject = vi.spyOn(provider, "putObject");
  const second = confirm(first.data.id);
  await reading;
  let original: unknown;
  let auditCount = 0;
  try {
    if (winner === "confirm") {
      const response = await confirm(first.data.id);
      expect(response.status).toBe(200);
      original = await response.json();
    } else {
      const { deleteDocumentInTransaction } = await import("@/data-access/document-mutations");
      const [row] = await documentRows(a);
      await db.transaction(tx => deleteDocumentInTransaction(a.ctx, tx, { documentId: row.id, expectedVersion: row.version }));
    }
    auditCount = (await documentAudits(a)).length;
    putObject.mockClear();
  } finally { release(); }
  const response = await second;
  expect(response.status).toBe(winner === "confirm" ? 200 : 404);
  if (winner === "confirm") expect(await response.json()).toEqual(original);
  expect(putObject).not.toHaveBeenCalled();
  expect(await documentAudits(a)).toHaveLength(auditCount);
}, READ_TIMEOUT_MS);
