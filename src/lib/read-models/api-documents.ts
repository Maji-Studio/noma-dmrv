import type { DocumentRow } from "@/data-access/documents";
import type { DocumentRepresentation } from "@/lib/representations/documents";
import { findApiFeedstock } from "@/data-access/api-feedstocks";
import { findApiDelivery } from "@/data-access/api-deliveries";
import { findApiLabSample } from "@/data-access/api-lab-samples";
import { findApiApplication } from "@/data-access/api-applications";
import { requireOrgScope } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { representDocument } from "@/lib/representations/documents";
import { readListPage, type ReadListQuery } from "./api-list";
import { findApiDocument, listApiDocuments, type ApiDocumentFilters } from "@/data-access/api-documents";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import { allowsApiDocumentType, type ApiDocumentOwnerType } from "@/lib/documents/api-owners";
export { documentNotFound } from "@/data-access/api-documents";

/** Direct resource resolvers deliberately retain archived records and ancestors. */
export async function resolveApiDocumentOwner(ctx: OrgContext, ownerType: ApiDocumentOwnerType, identifier: ApiLookupIdentifier) {
  requireOrgScope(ctx);
  const resolvers = { feedstock: findApiFeedstock, delivery: findApiDelivery, lab_sample: findApiLabSample, application: findApiApplication };
  try {
    return (await resolvers[ownerType](ctx, identifier)).id;
  } catch (error) {
    if (!(error instanceof DomainError) || error.code !== "not_found") throw error;
    throw new DomainError("not_found", "Document owner was not found.", {
      issues: [{ path: ["ownerId"], code: "not_found", message: "Document owner was not found." }],
    });
  }
}

export async function readApiDocumentList(ctx: OrgContext, ownerType: ApiDocumentOwnerType, ownerId: string, query: ReadListQuery<ApiDocumentFilters>) {
  requireOrgScope(ctx);
  if (query.filters.documentType && !allowsApiDocumentType(ownerType, query.filters.documentType)) {
    throw new DomainError("validation_failed", "Document type is not available for this record.", {
      issues: [{ path: ["documentType"], code: "invalid_value", message: "Choose an evidence type available for this record." }],
    });
  }
  return readListPage<ApiDocumentFilters, DocumentRow & { cursorCreatedAt: string }, DocumentRepresentation>(ctx, query,
    (ctx, filters, limit, cursor) => listApiDocuments(ctx, ownerType, ownerId, filters, limit, cursor), representDocument);
}

/** Storage fields stay inside the trusted read core and content adapter. */
export async function readApiDocument(ctx: OrgContext, ownerType: ApiDocumentOwnerType, ownerId: string, documentId: string) {
  return findApiDocument(ctx, ownerType, ownerId, documentId);
}
