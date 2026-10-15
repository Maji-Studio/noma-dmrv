/** Real routes, credentials and local storage. Supervisor runs this file against Postgres. */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications, creditBatches, documents, feedstocks, members, productionProcesses, samples } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { archiveFacility } from "@/data-access/facilities";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { DOCUMENT_CONFIRM_DEADLINE_MS, DOCUMENT_DOWNLOAD_TTL_SECONDS } from "@/config/documents";
import { API_DOCUMENT_OWNERS, type ApiDocumentOwnerType } from "@/lib/documents/api-owners";
import { confirmDocumentUpload } from "@/lib/documents/confirm-upload";
import { requestDocumentUpload } from "@/lib/operations/document-uploads";
import { runOperation } from "@/lib/operations/runner";
import { documentRepresentationSchema } from "@/lib/representations/documents";
import { __setStorageProviderForTests } from "@/lib/storage";
import { LocalFsProvider, verifyLocalFsToken } from "@/lib/storage/local-fs";
import { GET as feedstockList } from "@/app/api/v1/feedstocks/[idOrCode]/documents/route";
import { GET as feedstockGet } from "@/app/api/v1/feedstocks/[idOrCode]/documents/[documentId]/route";
import { GET as feedstockContent } from "@/app/api/v1/feedstocks/[idOrCode]/documents/[documentId]/content/route";
import { GET as deliveryList } from "@/app/api/v1/deliveries/[idOrCode]/documents/route";
import { GET as deliveryGet } from "@/app/api/v1/deliveries/[idOrCode]/documents/[documentId]/route";
import { GET as deliveryContent } from "@/app/api/v1/deliveries/[idOrCode]/documents/[documentId]/content/route";
import { GET as sampleList } from "@/app/api/v1/lab-samples/[idOrCode]/documents/route";
import { GET as sampleGet } from "@/app/api/v1/lab-samples/[idOrCode]/documents/[documentId]/route";
import { GET as sampleContent } from "@/app/api/v1/lab-samples/[idOrCode]/documents/[documentId]/content/route";
import { GET as applicationList } from "@/app/api/v1/applications/[idOrCode]/documents/route";
import { GET as applicationGet } from "@/app/api/v1/applications/[idOrCode]/documents/[documentId]/route";
import { GET as applicationContent } from "@/app/api/v1/applications/[idOrCode]/documents/[documentId]/content/route";
import { lookupProblem } from "./helpers/api-lookups";
import { createApiOrderReadFixture, insertReadDelivery, insertReadOrder, readRequest, removeApiOrderReadFixture,
  READ_ARCHIVE_AT, READ_TIMEOUT_MS, UNKNOWN_READ_ID } from "./helpers/api-order-read-fixture";

const AT = "2026-09-15T12:00:00.000Z";
const PAGE_LIMIT = 1;
const FILE_BYTES = Buffer.from("%PDF-1.7");
const SHA256 = createHash("sha256").update(FILE_BYTES).digest("hex");
const SAMPLE_TOTAL_CARBON_PERCENT = 80;
const SAMPLE_ORGANIC_CARBON_PERCENT = 78;
const STORAGE_SECRET = "document-read-test-secret";
const routes = {
  feedstock: { list: feedstockList, get: feedstockGet, content: feedstockContent },
  delivery: { list: deliveryList, get: deliveryGet, content: deliveryContent },
  lab_sample: { list: sampleList, get: sampleGet, content: sampleContent },
  application: { list: applicationList, get: applicationGet, content: applicationContent },
};
const ownerTypes = ["feedstock", "delivery", "lab_sample", "application"] as const;
async function fixture() {
  const f = await createApiOrderReadFixture();
  const key = (await createApiKey(f.ctx, { name: "Document reads", expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS,
    scopes: ["feedstocks:read", "deliveries:read", "lab-samples:read", "applications:read"] })).key;
  const [feedstock] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
  const order = await insertReadOrder(f, `OR-DOC-${f.tag}`);
  const delivery = await insertReadDelivery(f, order.id, 10);
  const [application] = await db.insert(applications).values({ organizationId: f.ctx.organizationId, code: `AP-DOC-${f.tag}`,
    deliveryId: delivery.id, applicationDate: new Date("2026-09-16T00:00:00Z"), biocharAppliedTons: 0.001,
    biocharAppliedDryTons: 0.001, fieldSizeHa: 1, gpsLatitude: 0, gpsLongitude: 0 }).returning();
  const [process] = await db.insert(productionProcesses).values({ organizationId: f.ctx.organizationId,
    facilityId: f.facility.id, feedstockTypeId: feedstock.feedstockTypeId }).returning();
  const [batch] = await db.insert(creditBatches).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
    code: `CB-DOC-${f.tag}`, feedstockTypeId: feedstock.feedstockTypeId, productionProcessId: process.id,
    startDate: "2026-09-01", endDate: "2026-09-30" }).returning();
  const [sample] = await db.insert(samples).values({ organizationId: f.ctx.organizationId, creditBatchId: batch.id,
    sampleCode: `LS-DOC-${f.tag}`, samplingTime: new Date(AT),
    totalCarbonPercent: SAMPLE_TOTAL_CARBON_PERCENT, organicCarbonPercent: SAMPLE_ORGANIC_CARBON_PERCENT }).returning();
  return { ...f, key, batch, owners: { feedstock, delivery, application, lab_sample: { ...sample, code: sample.sampleCode } } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
let a: Fixture;
let b: Fixture;
let provider: LocalFsProvider;
let root: string;
async function cleanup(f?: Fixture) {
  if (!f) return;
  await db.delete(samples).where(eq(samples.organizationId, f.ctx.organizationId));
  await db.delete(creditBatches).where(eq(creditBatches.organizationId, f.ctx.organizationId));
  await db.delete(productionProcesses).where(eq(productionProcesses.organizationId, f.ctx.organizationId));
  await removeApiOrderReadFixture(f);
}
beforeEach(async () => {
  a = await fixture(); b = await fixture();
  root = await mkdtemp(join(tmpdir(), "document-reads-"));
  provider = new LocalFsProvider({ root, appUrl: "http://localhost:3100", signingSecret: STORAGE_SECRET });
  __setStorageProviderForTests(provider);
}, READ_TIMEOUT_MS);
afterEach(async () => {
  __setStorageProviderForTests(null);
  await cleanup(a); await cleanup(b);
  if (root) await rm(root, { recursive: true, force: true });
}, READ_TIMEOUT_MS);
async function insert(ownerType: ApiDocumentOwnerType, values: Partial<typeof documents.$inferInsert> = {}, f = a) {
  const id = randomUUID();
  const owner = API_DOCUMENT_OWNERS[ownerType];
  const [row] = await db.insert(documents).values({ id, organizationId: f.ctx.organizationId,
    entityType: owner.entityType, entityId: f.owners[ownerType].id, documentType: owner.documentTypes[0],
    storageProvider: "local-fs", storageBucket: "local-fs", storageKey: `org/${f.ctx.organizationId}/final/${id}-${SHA256}.pdf`,
    fileName: "evidence.pdf", mimeType: "application/pdf", fileSizeBytes: FILE_BYTES.length, checksumSha256: SHA256,
    uploadStatus: "uploaded", createdAt: new Date(AT), updatedAt: new Date(AT), ...values }).returning();
  return row;
}
function call(owner: ApiDocumentOwnerType, kind: "list" | "get" | "content", options: {
  id?: string; documentId?: string; key?: string; query?: string; etag?: string;
} = {}) {
  const idOrCode = options.id ?? a.owners[owner].id;
  const suffix = kind === "list" ? "" : `/${options.documentId}${kind === "content" ? "/content" : ""}`;
  const request = readRequest(`/${API_DOCUMENT_OWNERS[owner].path}/${idOrCode}/documents${suffix}${options.query ?? ""}`, options.key ?? a.key);
  if (options.etag) request.headers.set("If-None-Match", options.etag);
  return routes[owner][kind](request, { params: Promise.resolve({ idOrCode, documentId: options.documentId }) });
}
const ids = async (response: Response): Promise<string[]> => (await response.json()).data.map((row: { id: string }) => row.id);

describe("nested document REST reads", { timeout: READ_TIMEOUT_MS }, () => {
  it.each(ownerTypes)("serves exact %s shapes by code, id and uppercase UUID", async (owner) => {
    const row = await insert(owner);
    expect(await ids(await call(owner, "list"))).toEqual([row.id]);
    for (const id of [a.owners[owner].id, a.owners[owner].id.toUpperCase(), a.owners[owner].code]) {
      const response = await call(owner, "get", { id, documentId: row.id.toUpperCase() });
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe('"1.1"');
      const { data } = await response.json();
      expect(documentRepresentationSchema.parse(data)).toEqual(data);
      expect(Object.keys(data).sort()).toEqual(Object.keys(documentRepresentationSchema.shape).sort());
      expect(data).toMatchObject({ id: row.id, ownerType: owner, ownerId: a.owners[owner].id, uploadStatus: "uploaded", sizeBytes: FILE_BYTES.length, sha256: SHA256 });
    }
  });

  it("pages by microseconds and descending UUID ties, binding owner, organization and filters", async () => {
    const early = await insert("delivery");
    const later = await insert("delivery");
    const tied = await insert("delivery");
    await db.update(documents).set({ createdAt: sql`'2026-09-15 12:00:00.123455'::timestamp` }).where(eq(documents.id, early.id));
    await db.update(documents).set({ createdAt: sql`'2026-09-15 12:00:00.123456'::timestamp` }).where(eq(documents.id, later.id));
    await db.update(documents).set({ createdAt: sql`'2026-09-15 12:00:00.123456'::timestamp` }).where(eq(documents.id, tied.id));
    const expected = [...[later.id, tied.id].sort().reverse(), early.id];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await call("delivery", "list", { id: a.owners.delivery.code, query: `?limit=${PAGE_LIMIT}${cursor ? `&cursor=${cursor}` : ""}` });
      expect(response.status).toBe(200);
      const page = await response.json();
      expect(page).not.toHaveProperty("total");
      seen.push(...page.data.map((row: { id: string }) => row.id)); cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(expected);
    const page = await (await call("delivery", "list", { query: `?limit=${PAGE_LIMIT}` })).json();
    for (const query of [`?cursor=${page.nextCursor}&uploadStatus=all`, `?cursor=${page.nextCursor}&documentType=bill_of_lading`]) {
      await lookupProblem(await call("delivery", "list", { query }), 400, "invalid_cursor");
    }
    await lookupProblem(await call("feedstock", "list", { query: `?cursor=${page.nextCursor}` }), 400, "invalid_cursor");
    const secondOwner = await insertReadDelivery(a, a.owners.delivery.orderId, 10);
    await lookupProblem(await call("delivery", "list", { id: secondOwner.id, query: `?cursor=${page.nextCursor}` }), 400, "invalid_cursor");
    await lookupProblem(await call("delivery", "list", { id: b.owners.delivery.id, key: b.key, query: `?cursor=${page.nextCursor}` }), 400, "invalid_cursor");
    expect(await ids(await call("delivery", "list", { id: a.owners.delivery.id.toUpperCase(), query: `?cursor=${page.nextCursor}` }))).toEqual(expected.slice(PAGE_LIMIT));
  });

  it.each(ownerTypes)("filters %s states and excludes app-only types and server-generated ledgers", async (owner) => {
    const uploaded = await insert(owner);
    const pending = await insert(owner, { uploadStatus: "pending", metadata: { uploadDeclaration: { contentType: "application/pdf", sizeBytes: FILE_BYTES.length, sha256: SHA256 } } });
    const failed = await insert(owner, { uploadStatus: "failed" });
    const hidden = await insert(owner, { documentType: "invoice" });
    const ledger = await insert(owner, { entityType: "credit_batch", entityId: a.batch.id, documentType: "pdf" });
    expect(await ids(await call(owner, "list"))).toEqual([uploaded.id]);
    for (const [state, row] of [["pending", pending], ["failed", failed]] as const) {
      expect(await ids(await call(owner, "list", { query: `?uploadStatus=${state}` }))).toEqual([row.id]);
      expect((await (await call(owner, "get", { documentId: row.id })).json()).data.uploadStatus).toBe(state);
    }
    expect(await ids(await call(owner, "list", { query: "?uploadStatus=all" }))).toEqual([uploaded.id, pending.id, failed.id].sort().reverse());
    for (const row of [hidden, ledger]) await lookupProblem(await call(owner, "get", { documentId: row.id }), 404, "not_found");
    for (const query of ["?unknown=1", "?documentType=invoice", "?uploadStatus=unknown", "?limit=1&limit=2"]) {
      await lookupProblem(await call(owner, "list", { query }), 400, "invalid_query");
    }
    expect(await ids(await call(owner, "list", { query: `?documentType=${uploaded.documentType}` }))).toEqual([uploaded.id]);
  });

  it("filters between two allowed delivery evidence types", async () => {
    await insert("delivery");
    const photo = await insert("delivery", { documentType: "photo" });
    expect(await ids(await call("delivery", "list", { query: "?documentType=photo" }))).toEqual([photo.id]);
    await lookupProblem(await call("feedstock", "list", { query: "?documentType=photo" }), 400, "invalid_query");
  });

  it("retains documents after facility and credit batch archive", async () => {
    const rows = await Promise.all(ownerTypes.map((owner) => insert(owner)));
    await archiveFacility(a.ctx, a.facility.id, a.facility.version);
    await db.update(creditBatches).set({ archivedAt: READ_ARCHIVE_AT }).where(eq(creditBatches.id, a.batch.id));
    for (const [index, owner] of ownerTypes.entries()) {
      expect(await ids(await call(owner, "list"))).toEqual([rows[index].id]);
      expect((await call(owner, "get", { documentId: rows[index].id })).status).toBe(200);
      expect((await call(owner, "content", { documentId: rows[index].id })).status).toBe(302);
    }
  });

  it.each(ownerTypes)("enforces %s scope before resolving unknown owners or documents", async (owner) => {
    for (const kind of ["list", "get", "content"] as const) {
      await lookupProblem(await call(owner, kind, { key: a.writeOnlyKey, id: UNKNOWN_READ_ID, documentId: UNKNOWN_READ_ID }), 403, "missing_scope");
      for (const id of [b.owners[owner].id, b.owners[owner].code, UNKNOWN_READ_ID, "unknown"]) {
        await lookupProblem(await call(owner, kind, { id, documentId: UNKNOWN_READ_ID }), 404, "not_found");
      }
    }
  });

  it("allows a feedstock-only read key only on feedstock documents", async () => {
    for (const owner of ownerTypes) {
      const row = await insert(owner);
      for (const kind of ["list", "get", "content"] as const) {
        const response = await call(owner, kind, { key: a.missingScopeKey, documentId: row.id });
        if (owner === "feedstock") expect(response.status).toBe(kind === "content" ? 302 : 200);
        else await lookupProblem(response, 403, "missing_scope");
      }
    }
  });

  it.each(ownerTypes)("lists and gets %s legacy evidence with unknown content type and size", async (owner) => {
    const uploaded = await insert(owner);
    const legacy = await insert(owner, { storageKey: null, fileUrl: "https://example.test/legacy.pdf",
      mimeType: null, fileSizeBytes: null });
    const list = await call(owner, "list");
    expect(list.status).toBe(200);
    const page = await list.json();
    expect(page.data.map((item: { id: string }) => item.id).sort()).toEqual([uploaded.id, legacy.id].sort());
    expect(page.data.find((item: { id: string }) => item.id === legacy.id)).toMatchObject({ contentType: null, sizeBytes: null });
    const get = await call(owner, "get", { documentId: legacy.id });
    expect(get.status).toBe(200);
    expect((await get.json()).data).toMatchObject({ id: legacy.id, contentType: null, sizeBytes: null });
    await lookupProblem(await call(owner, "content", { documentId: legacy.id }), 404, "not_found");
  });

  it("refuses a credential after its owner becomes a member, before resolving paths", async () => {
    await db.update(members).set({ role: "member" }).where(and(eq(members.organizationId, a.ctx.organizationId), eq(members.userId, a.ctx.userId)));
    for (const owner of ownerTypes) {
      const response = await call(owner, "get", { id: UNKNOWN_READ_ID, documentId: UNKNOWN_READ_ID });
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe("credential_owner_removed");
    }
  });

  it("hides foreign, other-owner, wrong-type and public documents with no fallback", async () => {
    const foreign = await insert("delivery", { visibility: "public" }, b);
    const secondOwner = await insertReadDelivery(a, a.owners.delivery.orderId, 10);
    const another = await insert("delivery", { entityId: secondOwner.id });
    const wrongType = await insert("feedstock", { entityId: a.owners.delivery.id });
    const histogram = await insert("lab_sample", { documentType: "reflectance_histogram" });
    expect(await ids(await call("lab_sample", "list"))).toEqual([]);
    for (const kind of ["get", "content"] as const) {
      await lookupProblem(await call("lab_sample", kind, { documentId: histogram.id }), 404, "not_found");
    }
    for (const row of [foreign, another, wrongType]) {
      for (const kind of ["get", "content"] as const) await lookupProblem(await call("delivery", kind, { documentId: row.id }), 404, "not_found");
    }
    expect(await ids(await call("delivery", "list"))).toEqual([]);
    for (const kind of ["get", "content"] as const) {
      for (const documentId of [UNKNOWN_READ_ID, "not-a-uuid"]) {
        await lookupProblem(await call("delivery", kind, { documentId }), 404, "not_found");
      }
      await lookupProblem(await call("delivery", kind, { documentId: foreign.id, query: "?unknown=1" }), 400, "invalid_query");
    }
  });

  it("returns strong ETags and changes the ETag after real upload confirmation", async () => {
    const { data } = await runOperation(requestDocumentUpload, a.ctx, { ownerType: "delivery", ownerId: a.owners.delivery.id,
      documentType: "bill_of_lading", fileName: "receipt.pdf", contentType: "application/pdf", sizeBytes: FILE_BYTES.length, sha256: SHA256 });
    const before = await call("delivery", "get", { documentId: data.id });
    expect(before.status).toBe(200);
    const tag = before.headers.get("etag")!;
    expect(tag).toBe('"1.1"');
    const repeated = await call("delivery", "get", { documentId: data.id, etag: tag });
    expect(repeated.status).toBe(200);
    expect(repeated.headers.get("etag")).toBe(tag);
    expect((await repeated.json()).data.id).toBe(data.id);
    const [stored] = await db.select().from(documents).where(eq(documents.id, data.id));
    await provider.putObject(stored.uploadStorageKey!, FILE_BYTES, "application/pdf");
    await confirmDocumentUpload(a.ctx, { ownerType: "delivery", ownerId: a.owners.delivery.id, documentId: data.id }, { deadlineAt: Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS });
    const after = await call("delivery", "get", { documentId: data.id, etag: tag });
    expect(after.status).toBe(200); expect(after.headers.get("etag")).toBe('"2.1"');
    expect((await after.json()).data).toMatchObject({ uploadStatus: "uploaded", sha256: SHA256 });
    const content = await call("delivery", "content", { documentId: data.id });
    expect(content.status).toBe(302);
    const url = new URL(content.headers.get("location")!);
    const claims = verifyLocalFsToken(STORAGE_SECRET, url.searchParams.get("token")!);
    expect(claims?.k).toContain(SHA256);
    expect(claims?.k).not.toContain("/uploads/");
    expect(claims?.k).not.toBe(stored.uploadStorageKey);
  });

  it.each(ownerTypes)("redirects %s uploaded content privately for five minutes and refuses pending, failed and legacy rows", async (owner) => {
    const row = await insert(owner);
    await provider.putObject(row.storageKey!, FILE_BYTES, "application/pdf");
    const before = Date.now();
    const response = await call(owner, "content", { documentId: row.id });
    const after = Date.now();
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("authorization")).toBeNull();
    const location = response.headers.get("location")!;
    expect(location).not.toContain(a.key);
    const url = new URL(location);
    const claims = verifyLocalFsToken(STORAGE_SECRET, url.searchParams.get("token")!);
    expect(claims).toMatchObject({ k: row.storageKey, m: "GET" });
    const ttlMs = DOCUMENT_DOWNLOAD_TTL_SECONDS * 1000;
    expect(claims!.e).toBeGreaterThanOrEqual(before + ttlMs);
    expect(claims!.e).toBeLessThanOrEqual(after + ttlMs);
    for (const uploadStatus of ["pending", "failed"] as const) {
      const unready = await insert(owner, { uploadStatus });
      await lookupProblem(await call(owner, "content", { documentId: unready.id }), 404, "not_found");
    }
    const legacy = await insert(owner, { storageKey: null, fileUrl: "https://example.test/legacy.pdf" });
    await lookupProblem(await call(owner, "content", { documentId: legacy.id }), 404, "not_found");
  });
});
