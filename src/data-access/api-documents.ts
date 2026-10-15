import { and, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { documentNotFound } from "./document-write-scope";
export { documentNotFound } from "./document-write-scope";
import { API_DOCUMENT_OWNERS, type ApiDocumentOwnerType } from "@/lib/documents/api-owners";
import type { DocumentType } from "@/schemas/documents";
import { requireOrgScope, type Executor } from "./utils";
import { lookupCursorCreatedAt, lookupPosition, type ApiLookupPosition } from "./api-lookup-filters";

export interface ApiDocumentFilters {
  documentType?: DocumentType;
  uploadStatus?: "uploaded" | "pending" | "failed" | "all";
}

export async function listApiDocuments(ctx: OrgContext, ownerType: ApiDocumentOwnerType, ownerId: string,
  filters: ApiDocumentFilters, limit: number, cursor?: ApiLookupPosition, executor: Executor = db) {
  requireOrgScope(ctx);
  const owner = API_DOCUMENT_OWNERS[ownerType];
  const status = filters.uploadStatus ?? "uploaded";
  return executor.select({ ...getTableColumns(documents), cursorCreatedAt: lookupCursorCreatedAt(documents.createdAt) }).from(documents).where(and(
    eq(documents.organizationId, ctx.organizationId), eq(documents.entityType, owner.entityType), eq(documents.entityId, ownerId),
    inArray(documents.documentType, [...owner.documentTypes]),
    filters.documentType ? eq(documents.documentType, filters.documentType) : undefined,
    status === "all" ? undefined : eq(documents.uploadStatus, status), lookupPosition(documents, cursor),
  )).orderBy(desc(documents.createdAt), desc(documents.id)).limit(limit + 1);
}

export async function findApiDocument(ctx: OrgContext, ownerType: ApiDocumentOwnerType, ownerId: string,
  documentId: string, executor: Executor = db) {
  requireOrgScope(ctx);
  const owner = API_DOCUMENT_OWNERS[ownerType];
  const [row] = await executor.select().from(documents).where(and(
    eq(documents.organizationId, ctx.organizationId), eq(documents.entityType, owner.entityType),
    eq(documents.entityId, ownerId), eq(documents.id, documentId),
    inArray(documents.documentType, [...owner.documentTypes]),
  )).limit(1);
  if (!row) throw documentNotFound();
  return row;
}
