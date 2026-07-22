import { inArray, sql, type SQLWrapper } from "drizzle-orm";
import { deliveries, documents, orders } from "@/db/schema";
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

/**
 * Evidence for the auto-derived biochar distribution leg lives on the
 * DELIVERIES it aggregates (the leg row is synced from them and owns no
 * documents itself), so the count walks delivery ownership — directly or via
 * the delivery's order — back to the biochar product.
 */
export function biocharTransportEvidenceDocumentCount(
  organizationId: string,
  biocharProductId: SQLWrapper,
) {
  return sql<number>`(
    select count(*)::int
    from ${documents}
    where ${documents.organizationId} = ${organizationId}
      and ${documents.entityType} = 'delivery'
      and ${documents.uploadStatus} = 'uploaded'
      and ${inArray(
        documents.documentType,
        [...TRANSPORT_EVIDENCE_DOCUMENT_TYPES],
      )}
      and ${documents.entityId} in (
        select ${deliveries.id}
        from ${deliveries}
        left join ${orders}
          on ${orders.id} = ${deliveries.orderId}
         and ${orders.organizationId} = ${organizationId}
        where ${deliveries.organizationId} = ${organizationId}
          and coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId}) = ${biocharProductId}
      )
  )`;
}
