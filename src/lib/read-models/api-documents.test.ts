import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { readApiDocumentList, readApiDocument, resolveApiDocumentOwner } from "./api-documents";
import type { OrgContext } from "@/lib/auth/server";

const database = vi.hoisted(() => ({ rows: [] as unknown[][], queries: [] as unknown[], current: [] as unknown[] }));
vi.mock("@/db", () => {
  const chain = {
    from: () => chain, leftJoin: () => chain, innerJoin: () => chain,
    where: (condition: unknown) => { database.queries.push(condition); return chain; },
    orderBy: () => chain,
    limit: async () => database.current,
  };
  return { db: { select: () => { database.current = database.rows.shift() ?? []; return chain; } } };
});
const ctx: OrgContext = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "user", orgRole: "admin", isPlatformAdmin: false };
const ownerId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const row = { id: documentId, entityType: "delivery", entityId: ownerId, documentType: "photo", fileName: "photo.png",
  mimeType: "image/png", fileSizeBytes: 12, checksumSha256: "a".repeat(64), uploadStatus: "uploaded", capturedAt: null,
  description: null, metadata: {}, version: 1, createdAt: new Date("2026-01-01Z"), updatedAt: new Date("2026-01-01Z"),
  cursorCreatedAt: "2026-01-01T00:00:00.123456Z" };
beforeEach(() => { database.rows = []; database.queries = []; });

it("reads an archived owner through its existing resolver", async () => {
  database.rows = [[{ id: ownerId, archivedAt: new Date() }]];
  expect(await resolveApiDocumentOwner(ctx, "delivery", { id: ownerId })).toBe(ownerId);
});

it("scopes document lists to organization, owner, API types and uploaded by default", async () => {
  database.rows = [[row, { ...row, id: "44444444-4444-4444-8444-444444444444" }]];
  const page = await readApiDocumentList(ctx, "delivery", ownerId, { filters: {}, limit: 1 });
  expect(page.data).toHaveLength(1);
  expect(page.data[0]).toMatchObject({ id: documentId, ownerType: "delivery", sizeBytes: 12 });
  expect(page.nextPosition).toEqual({ id: documentId, createdAt: row.cursorCreatedAt });
  const query = new PgDialect().sqlToQuery(database.queries[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(query.params).toEqual(expect.arrayContaining([ctx.organizationId, ownerId, "delivery", "photo", "uploaded"]));
  expect(query.sql).toContain('"documents"."organization_id"');
});

it("does not expose missing documents and refuses an unscoped context", async () => {
  database.rows = [[]];
  await expect(readApiDocument(ctx, "delivery", ownerId, documentId)).rejects.toMatchObject({ code: "not_found" });
  await expect(readApiDocument({ ...ctx, organizationId: "" }, "delivery", ownerId, documentId)).rejects.toThrow();
});

it("filters pending and failed evidence, while all removes only the state restriction", async () => {
  for (const uploadStatus of ["pending", "failed", "all"] as const) {
    database.rows = [[]]; database.queries = [];
    expect(await readApiDocumentList(ctx, "delivery", ownerId, { filters: { documentType: "photo", uploadStatus }, limit: 2 }))
      .toEqual({ data: [], nextPosition: null });
    const query = new PgDialect().sqlToQuery(database.queries[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(query.params).toContain("photo");
    if (uploadStatus === "all") expect(query.sql).not.toContain('"upload_status"');
    else expect(query.params).toContain(uploadStatus);
  }
});

it("refuses an app-only type even for a direct read-model caller", async () => {
  await expect(readApiDocumentList(ctx, "feedstock", ownerId, { filters: { documentType: "photo" }, limit: 2 }))
    .rejects.toMatchObject({ code: "validation_failed" });
});

it("constrains direct gets by the organization, exact owner type and document id", async () => {
  database.rows = [[row]];
  expect(await readApiDocument(ctx, "delivery", ownerId, documentId)).toEqual(row);
  const query = new PgDialect().sqlToQuery(database.queries[0] as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(query.params).toEqual(expect.arrayContaining([ctx.organizationId, "delivery", ownerId, documentId]));
  expect(query.sql).toContain('"documents"."document_type" in');
});

it("points missing owner errors at ownerId for every owner type", async () => {
  for (const ownerType of ["feedstock", "delivery", "lab_sample"] as const) {
    database.rows = [[]];
    await expect(resolveApiDocumentOwner(ctx, ownerType, { id: ownerId })).rejects.toMatchObject({
      code: "not_found", issues: [expect.objectContaining({ path: ["ownerId"] })],
    });
  }
});

it("includes legacy rows with unknown MIME type and size in a document page", async () => {
  database.rows = [[{ ...row, mimeType: null, fileSizeBytes: null }]];
  const page = await readApiDocumentList(ctx, "delivery", ownerId, { filters: {}, limit: 2 });
  expect(page.data[0]).toMatchObject({ id: documentId, contentType: null, sizeBytes: null });
});
