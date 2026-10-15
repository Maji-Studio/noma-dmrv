/** Real actions, REST, MCP and Postgres with local storage. Not run, needs the supervisor. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { documents, deliveries } from "@/db/schema";
import { requestUpload, confirmUpload, getDocumentsForEntity } from "@/fn/documents";
import { jsonPointer } from "@/lib/api/problem";
import { documentRepresentationSchema, representDocument } from "@/lib/representations/documents";
import { documentUploadEnvelopeSchema } from "@/lib/representations/document-writes";
import { __setStorageProviderForTests } from "@/lib/storage";
import { LocalFsProvider } from "@/lib/storage/local-fs";
import { UPLOAD_UNAVAILABLE_WARNINGS } from "@/lib/documents/upload-capability";
import { DOCUMENT_UPLOAD_MAX_LIFETIME_MS } from "@/config/documents";
import { createApiDocumentWriteFixture, removeApiDocumentWriteFixture, callDocumentWrite, documentInput, submitDocumentDelivery, DOCUMENT_BYTES, type ApiDocumentWriteFixture } from "./helpers/api-document-write-fixture";
import { documentTool, putDocument, downloadDocument, restDocumentRead } from "./helpers/document-transport";
import { READ_TIMEOUT_MS } from "./helpers/api-order-read-fixture";

const mocks = vi.hoisted(() => ({ root: "", secret: "parity-document-test-signing-secret", auth: vi.fn() }));
vi.mock("@/lib/auth/server", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: mocks.auth }));
vi.mock("@/config/env", async importOriginal => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, STORAGE_PROVIDER: "local-fs", STORAGE_SIGNING_SECRET: mocks.secret,
    get STORAGE_LOCAL_FS_ROOT() { return mocks.root; } } };
});
const TRANSPORTS = ["action", "rest", "mcp"] as const;
type Transport = typeof TRANSPORTS[number];
let f: ApiDocumentWriteFixture;
let provider: LocalFsProvider;
beforeEach(async () => {
  f = await createApiDocumentWriteFixture();
  mocks.auth.mockResolvedValue(f.ctx);
  mocks.root = await mkdtemp(join(tmpdir(), "document-parity-"));
  provider = new LocalFsProvider({ root: mocks.root, appUrl: "http://localhost:3100", signingSecret: mocks.secret });
  __setStorageProviderForTests(provider);
}, READ_TIMEOUT_MS);
afterEach(async () => {
  vi.restoreAllMocks(); mocks.auth.mockReset(); __setStorageProviderForTests(null);
  if (f) await removeApiDocumentWriteFixture(f);
  if (mocks.root) await rm(mocks.root, { recursive: true, force: true });
}, READ_TIMEOUT_MS);
function uploadBody(raw: unknown) {
  const body = documentUploadEnvelopeSchema.parse(raw);
  return { ...body, data: documentRepresentationSchema.parse(body.data) };
}
const owner = () => ({ ownerType: "delivery", ownerId: f.owners.delivery.id });
async function request(transport: Transport, key = randomUUID()) {
  if (transport === "rest") {
    const response = await callDocumentWrite(f, "delivery", "request", { key });
    expect(response.status).toBe(201);
    return uploadBody(await response.json());
  }
  if (transport === "mcp") {
    const result = await documentTool(f, "request_document_upload", { ...owner(), ...documentInput(), requestKey: key });
    expect(result.isError).toBeUndefined();
    return uploadBody(result.structuredContent);
  }
  const result = await requestUpload({ ...documentInput(), entityType: "delivery", entityId: f.owners.delivery.id });
  if (!result.success) throw new Error(result.error);
  const read = await restDocumentRead(f, "delivery", "get", result.data.documentId);
  expect(read.status).toBe(200);
  return uploadBody({ ...await read.json(), upload: {
    url: result.data.uploadUrl, method: "PUT", headers: result.data.headers, expiresAt: result.data.expiresAt,
  } });
}
interface Issue { pointer: string; code: string; meta?: Record<string, unknown> }
interface Refusal { code?: string; issues: Issue[] }
function apiRefusal(output: { code: string; errors?: Issue[]; issues?: Issue[] }): Refusal {
  return { code: output.code, issues: (output.errors ?? output.issues ?? []).map(({ pointer, code, meta }) => ({ pointer, code, ...(meta ? { meta } : {}) })) };
}
async function confirm(transport: Transport, documentId: string) {
  if (transport === "action") {
    const result = await confirmUpload({ documentId });
    if (result.success) return { data: representDocument(result.data) };
    return { code: result.code, issues: (result.issues ?? []).map(({ path, code, meta }) => ({
      // App identifies the delivery owner by deliveryId; API transports use ownerId.
      pointer: jsonPointer(path).replace(/^\/deliveryId$/, "/ownerId"), code, ...(meta ? { meta } : {}),
    })) };
  }
  if (transport === "rest") {
    const response = await callDocumentWrite(f, "delivery", "confirm", { documentId });
    const body = await response.json();
    return response.ok ? body : apiRefusal(body);
  }
  const result = await documentTool(f, "confirm_document_upload", { ...owner(), documentId });
  expect(result.isError).toBe(result.structuredContent.code ? true : undefined);
  if (result.isError) return apiRefusal(result.structuredContent);
  return result.structuredContent;
}
/** Compare all published facts, excluding generated identities and signing instants. */
function stable(value: unknown) {
  return JSON.parse(JSON.stringify(value, (key, value) => ["id", "createdAt", "updatedAt", "expiresAt", "url"].includes(key) ? undefined : value));
}

describe("document transport parity", { timeout: READ_TIMEOUT_MS }, () => {
  it("requests the same pending document and upload headers through the app, REST and MCP", async () => {
    const outcomes = [];
    for (const transport of TRANSPORTS) {
      const body = await request(transport);
      expect(body.upload).not.toBeNull();
      expect(body.warnings).toBeUndefined();
      expect(new Date(body.upload!.expiresAt).getTime()).toBeGreaterThan(Date.now());
      outcomes.push(stable(body));
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
  });

  it("confirms the same facts and returns matching list pages, detail and download bytes", async () => {
    const outcomes = [];
    for (const transport of TRANSPORTS) {
      const pending = await request(transport);
      await putDocument(pending.upload!);
      const result = await confirm(transport, pending.data.id);
      expect(result).toMatchObject({ data: { uploadStatus: "uploaded", version: 2 } });
      expect(await confirm(transport, pending.data.id)).toEqual(result);
      const detail = await restDocumentRead(f, "delivery", "get", pending.data.id);
      expect(await detail.json()).toEqual(result);
      outcomes.push(stable(result));
      const link = await documentTool(f, "get_document_download_url", { ...owner(), documentId: pending.data.id });
      const content = await restDocumentRead(f, "delivery", "content", pending.data.id);
      expect(content.status).toBe(302);
      expect(await downloadDocument(content.headers.get("location")!)).toEqual(DOCUMENT_BYTES);
      expect(await downloadDocument(link.structuredContent.url)).toEqual(DOCUMENT_BYTES);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
    const app = await getDocumentsForEntity("delivery", f.owners.delivery.id);
    if (!app.success) throw new Error(app.error);
    const all = await documentTool(f, "find_documents", owner());
    expect(all.structuredContent.data).toEqual(app.data.map(representDocument).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)));
    const first = await documentTool(f, "find_documents", { ...owner(), limit: 1 });
    expect(first.structuredContent).toEqual(await (await restDocumentRead(f, "delivery", "list", undefined, "?limit=1")).json());
    expect(first.structuredContent.nextCursor).toEqual(expect.any(String));
    const cursor = first.structuredContent.nextCursor;
    const next = await documentTool(f, "find_documents", { ...owner(), limit: 1, cursor });
    expect(next.structuredContent).toEqual(await (await restDocumentRead(f, "delivery", "list", undefined, `?limit=1&cursor=${encodeURIComponent(cursor)}`)).json());
  });

  it.each([
    { reason: "size", pointer: "/sizeBytes", bytes: Buffer.from("%PDF-1") },
    { reason: "type", pointer: "/contentType", bytes: Buffer.from("not pdf!") },
    { reason: "checksum", pointer: "/sha256", bytes: Buffer.from("%PDF-1.8") },
  ])("preserves $reason codes, pointers and meta on refusal and failed replay", async ({ reason, pointer, bytes }) => {
    const refusals = [], replays = [];
    for (const transport of TRANSPORTS) {
      const pending = await request(transport);
      await putDocument(pending.upload!, bytes);
      const refusal = await confirm(transport, pending.data.id);
      expect(refusal).toEqual({ code: "validation_failed", issues: [{ code: reason, pointer }] });
      refusals.push(refusal);
      const replay = await confirm(transport, pending.data.id);
      expect(replay).toEqual({ code: "conflict", issues: [{ code: reason, pointer: "/documentId" }] });
      replays.push(replay);
    }
    expect(refusals[1]).toEqual(refusals[0]); expect(refusals[2]).toEqual(refusals[0]);
    expect(replays[1]).toEqual(replays[0]); expect(replays[2]).toEqual(replays[0]);
  });

  it("returns the same gone outcome", async () => {
    for (const transport of TRANSPORTS) expect(await confirm(transport, randomUUID())).toEqual({
      code: "not_found", issues: [{ code: "not_found", pointer: "/documentId" }],
    });
  });

  it("commits certification refusal and preserves its reason on replay in all three transports", async () => {
    const pending = new Map<Transport, Awaited<ReturnType<typeof request>>>();
    for (const transport of TRANSPORTS) pending.set(transport, await request(transport));
    await submitDocumentDelivery(f);
    for (const transport of TRANSPORTS) {
      const documentId = pending.get(transport)!.data.id;
      expect(await confirm(transport, documentId)).toEqual({ code: "certification_locked", issues: [{ code: "certification_locked", pointer: "/ownerId" }] });
      expect(await confirm(transport, documentId)).toEqual({ code: "conflict", issues: [{ code: "certification_locked", pointer: "/documentId" }] });
    }
  });

  it("replays a REST request through MCP with a fresh pending capability", async () => {
    const key = randomUUID();
    const first = await request("rest", key);
    const REPLAY_DELAY_MS = 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + REPLAY_DELAY_MS);
    let replay;
    try { replay = await request("mcp", key); } finally { clock.mockRestore(); }
    expect(replay.data).toEqual(first.data);
    expect(replay.warnings).toEqual(first.warnings);
    expect(replay.upload!.headers).toEqual(first.upload!.headers);
    expect(replay.upload!.url).not.toBe(first.upload!.url);
    expect(new Date(replay.upload!.expiresAt).getTime()).toBeGreaterThan(new Date(first.upload!.expiresAt).getTime());
  });

  // The app has no idempotent request/replay interface. These envelopes belong to REST and MCP.
  it.each(["uploaded", "failed", "deleted", "expired", "owner_archived", "certification_locked"] as const)("replays upload null with the same %s reason", async reason => {
    const key = randomUUID();
    const original = await request("rest", key);
    const predicate = and(eq(documents.organizationId, f.ctx.organizationId), eq(documents.id, original.data.id));
    if (reason === "uploaded") { await putDocument(original.upload!); await confirm("rest", original.data.id); }
    else if (reason === "failed") { await putDocument(original.upload!, Buffer.from("%PDF-1.8")); await confirm("rest", original.data.id); }
    else if (reason === "deleted") await db.delete(documents).where(predicate);
    else if (reason === "expired") await db.update(documents).set({ createdAt: new Date(Date.now() - DOCUMENT_UPLOAD_MAX_LIFETIME_MS) }).where(predicate);
    else if (reason === "owner_archived") await db.update(deliveries).set({ archivedAt: new Date() }).where(and(eq(deliveries.organizationId, f.ctx.organizationId), eq(deliveries.id, f.owners.delivery.id)));
    else await submitDocumentDelivery(f);
    const expected = { data: original.data, upload: null, warnings: [UPLOAD_UNAVAILABLE_WARNINGS[reason]] };
    expect(await request("rest", key)).toEqual(expected);
    expect(await request("mcp", key)).toEqual(expected);
  });
});
