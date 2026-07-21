import { inArray, sql, type SQLWrapper } from "drizzle-orm";
import { documents } from "@/db/schema";
import { TRANSPORT_EVIDENCE_DOCUMENT_TYPES } from "@/lib/certification/transport-evidence";

/** Correlated, org-scoped count that does not multiply the parent query. */
export function transportEvidenceDocumentCount(
  organizationId: string,
  entityType: "feedstock" | "delivery" | "transport_leg",
  entityId: SQLWrapper,
) {
  return sql<number>`(
    select count(*)::int
    from ${documents}
    where ${documents.organizationId} = ${organizationId}
      and ${documents.entityType} = ${entityType}
      and ${documents.entityId} = ${entityId}
      and ${documents.uploadStatus} = 'uploaded'
      and ${inArray(
        documents.documentType,
        [...TRANSPORT_EVIDENCE_DOCUMENT_TYPES],
      )}
  )`;
}
