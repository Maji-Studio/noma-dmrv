import { UPLOAD_UNAVAILABLE_WARNINGS } from "@/lib/documents/upload-capability";
/** Real MCP endpoint, Postgres and local storage. Not run, needs the supervisor. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { documents, feedstocks } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { API_DOCUMENT_OWNERS, API_DOCUMENT_OWNER_TYPES } from "@/lib/documents/api-owners";
import { __setStorageProviderForTests } from "@/lib/storage";
import { LocalFsProvider } from "@/lib/storage/local-fs";
import { createApiDocumentWriteFixture, removeApiDocumentWriteFixture, documentInput, documentAudits, documentRecords, submitDocumentDelivery, DOCUMENT_BYTES, DOCUMENT_SHA256, type ApiDocumentWriteFixture } from "./helpers/api-document-write-fixture";
import { documentTool, putDocument, downloadDocument } from "./helpers/document-transport";
import { READ_TIMEOUT_MS } from "./helpers/api-order-read-fixture";

const storage = vi.hoisted(() => ({ root: "", secret: "mcp-document-test-signing-secret" }));
vi.mock("@/config/env", async importOriginal => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, STORAGE_PROVIDER: "local-fs", STORAGE_SIGNING_SECRET: storage.secret,
    get STORAGE_LOCAL_FS_ROOT() { return storage.root; } } };
});
let a: ApiDocumentWriteFixture;
let b: ApiDocumentWriteFixture;
let provider: LocalFsProvider;
beforeEach(async () => {
  a = await createApiDocumentWriteFixture(); b = await createApiDocumentWriteFixture();
  storage.root = await mkdtemp(join(tmpdir(), "mcp-documents-"));
  provider = new LocalFsProvider({ root: storage.root, appUrl: "http://localhost:3100", signingSecret: storage.secret });
  __setStorageProviderForTests(provider);
}, READ_TIMEOUT_MS);
afterEach(async () => {
  vi.restoreAllMocks(); __setStorageProviderForTests(null);
  for (const f of [a, b]) if (f) await removeApiDocumentWriteFixture(f);
  if (storage.root) await rm(storage.root, { recursive: true, force: true });
}, READ_TIMEOUT_MS);
const target = () => ({ ownerType: "delivery", ownerId: a.owners.delivery.id });
async function request(extra: Record<string, unknown> = {}) {
  const result = await documentTool(a, "request_document_upload", { ...target(), ...documentInput(), requestKey: randomUUID(), ...extra });
  expect(result.isError).toBeUndefined();
  return result.structuredContent;
}
async function failure(name: string, args: Record<string, unknown>, code: string, pointer?: string, credential = a.writeKey) {
  const result = await documentTool(a, name, args, credential);
  expect(result).toMatchObject({ isError: true, structuredContent: { code } });
  if (pointer) expect(result.structuredContent.issues).toContainEqual(expect.objectContaining({ pointer }));
  return result.structuredContent;
}

describe("MCP documents", { timeout: READ_TIMEOUT_MS }, () => {
  it.each(API_DOCUMENT_OWNER_TYPES)("uploads, confirms, finds and downloads %s evidence", async ownerType => {
    const ownerId = a.owners[ownerType].code;
    const pending = await request({ ownerType, ownerId, ...documentInput(ownerType) });
    expect(pending.data).toMatchObject({ ownerType, ownerId: a.owners[ownerType].id, uploadStatus: "pending" });
    const args = { ownerType, ownerId, documentId: pending.data.id };
    await failure("get_document_download_url", args, "not_found", "/documentId");
    await putDocument(pending.upload);
    const confirmed = await documentTool(a, "confirm_document_upload", args);
    expect(confirmed.isError).toBeUndefined();
    expect(confirmed.structuredContent.data).toMatchObject({ uploadStatus: "uploaded", sha256: DOCUMENT_SHA256, version: 2 });
    const page = await documentTool(a, "find_documents", { ownerType, ownerId });
    expect(page.structuredContent).toEqual({ data: [confirmed.structuredContent.data], nextCursor: null });
    const link = await documentTool(a, "get_document_download_url", args);
    expect(link.structuredContent.url).not.toContain(a.writeKey);
    expect(new Date(link.structuredContent.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(await downloadDocument(link.structuredContent.url)).toEqual(DOCUMENT_BYTES);
    expect((await documentTool(a, "confirm_document_upload", args)).structuredContent).toEqual(confirmed.structuredContent);
    expect((await documentAudits(a)).map(row => [row.operationId, row.transport]).sort()).toEqual([
      ["confirm_document_upload", "mcp"], ["request_document_upload", "mcp"],
    ]);
    expect(await documentRecords(a)).toHaveLength(1);
  });

  it("replays with a fresh link and the same historical representation", async () => {
    const requestKey = randomUUID();
    const first = await request({ requestKey });
    const DELAY_MS = 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + DELAY_MS);
    const replay = await request({ requestKey, ownerId: a.owners.delivery.id.toUpperCase() });
    clock.mockRestore();
    expect(replay.data).toEqual(first.data);
    expect(replay.upload.url).not.toBe(first.upload.url);
    expect(new Date(replay.upload.expiresAt).getTime()).toBeGreaterThan(new Date(first.upload.expiresAt).getTime());
  });

  it("replays a UUID request after deleting its owner through the delete operation", async () => {
    const [feedstock] = await db.insert(feedstocks).values({ ...a.owners.feedstock,
      id: randomUUID(), code: `E2E-DOC-DELETE-${a.tag}` }).returning();
    const args = { ownerType: "feedstock", ownerId: feedstock.id, ...documentInput("feedstock"), requestKey: randomUUID() };
    const first = await request(args);
    const current = await documentTool(a, "get_feedstock", { idOrCode: args.ownerId });
    expect(current.isError).toBeUndefined();
    const deleted = await documentTool(a, "delete_feedstock", {
      feedstockId: args.ownerId, expectedVersion: current.structuredContent.data.version, requestKey: randomUUID(),
    });
    expect(deleted.isError).toBeUndefined();
    expect(deleted.structuredContent.deleted.id).toBe(args.ownerId);
    expect(await request(args)).toEqual({ data: first.data, upload: null, warnings: [UPLOAD_UNAVAILABLE_WARNINGS.deleted] });
  });

  it.each([
    { reason: "size", pointer: "/sizeBytes", bytes: Buffer.from("%PDF-1") },
    { reason: "type", pointer: "/contentType", bytes: Buffer.from("not pdf!") },
    { reason: "checksum", pointer: "/sha256", bytes: Buffer.from("%PDF-1.8") },
  ])("returns $reason as isError and preserves the reason on failed replay", async ({ reason, pointer, bytes }) => {
    const pending = await request();
    await putDocument(pending.upload, bytes);
    const args = { ...target(), documentId: pending.data.id };
    const refused = await failure("confirm_document_upload", args, "validation_failed", pointer);
    expect(refused.issues[0].code).toBe(reason);
    const replay = await failure("confirm_document_upload", args, "conflict", "/documentId");
    expect(replay.issues[0].code).toBe(reason);
    await failure("get_document_download_url", args, "not_found", "/documentId");
  });

  it("keeps a missing object retryable and refuses submitted records", async () => {
    const pending = await request();
    const args = { ...target(), documentId: pending.data.id };
    expect((await failure("confirm_document_upload", args, "conflict")).retryable).toBe(true);
    await submitDocumentDelivery(a);
    const locked = await failure("confirm_document_upload", args, "certification_locked", "/ownerId");
    expect(locked.issues[0].code).toBe("certification_locked");
    await failure("request_document_upload", { ...target(), ...documentInput(), requestKey: randomUUID() }, "certification_locked", "/ownerId");
  });

  it("returns 404 for a foreign owner and a document under another owner", async () => {
    const pending = await request();
    const foreign = { ownerType: "delivery", ownerId: b.owners.delivery.id };
    await failure("request_document_upload", { ...foreign, ...documentInput(), requestKey: randomUUID() }, "not_found", "/ownerId");
    await failure("find_documents", foreign, "not_found", "/ownerId");
    for (const name of ["confirm_document_upload", "get_document_download_url"]) {
      await failure(name, { ...foreign, documentId: pending.data.id }, "not_found");
      await failure(name, { ownerType: "feedstock", ownerId: a.owners.feedstock.id, documentId: pending.data.id }, "not_found", "/documentId");
      await failure(name, { ...target(), documentId: randomUUID() }, "not_found", "/documentId");
    }
  });

  it.each(API_DOCUMENT_OWNER_TYPES)("checks each selected owner scope for a %s credential", async allowed => {
    const credential = (await createApiKey(a.ctx, { name: "Document owner scope", expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
      scopes: [API_DOCUMENT_OWNERS[allowed].readScope, API_DOCUMENT_OWNERS[allowed].writeScope] })).key;
    for (const denied of API_DOCUMENT_OWNER_TYPES.filter(owner => owner !== allowed)) {
      const args = { ownerType: denied, ownerId: b.owners[denied].id, documentId: randomUUID() };
      for (const name of ["find_documents", "get_document_download_url", "request_document_upload", "confirm_document_upload"]) {
        await failure(name, args, "missing_scope", undefined, credential);
      }
    }
  });

  it("refuses keys and versions on confirm, dry runs, and legacy downloads", async () => {
    const pending = await request();
    const args = { ...target(), documentId: pending.data.id };
    for (const extra of [{ requestKey: "key" }, { expectedVersion: 1 }]) await failure("confirm_document_upload", { ...args, ...extra }, "validation_failed");
    await failure("confirm_document_upload", { ...args, dryRun: true }, "validation_failed");
    await failure("request_document_upload", { ...target(), ...documentInput(), dryRun: true }, "validation_failed");
    await db.update(documents).set({ uploadStatus: "uploaded", storageKey: null, fileUrl: "https://example.test/legacy.pdf" })
      .where(and(eq(documents.organizationId, a.ctx.organizationId), eq(documents.id, pending.data.id)));
    await failure("get_document_download_url", args, "not_found", "/documentId");
  });
});
