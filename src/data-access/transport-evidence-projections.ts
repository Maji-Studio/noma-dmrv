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
 * documents itself). Semantics: the MINIMUM accepted-file count across the
 * contributing (delivered, non-archived — the same set the leg aggregation
 * and the dashboard gap query read) deliveries, so the result is > 0 only
 * when EVERY contributing delivery carries at least one accepted file. This
 * keeps `hasCompleteTransportEvidence` over this count consistent with the
 * dashboard's per-delivery evidence rule — a file on an upcoming, archived,
 * or sibling delivery must not turn the leg green. No contributing
 * deliveries → 0 (fails closed).
 */
export function biocharTransportEvidenceDocumentCount(
  organizationId: string,
  biocharProductId: SQLWrapper,
) {
  return sql<number>`(
    select coalesce(min(per_delivery.accepted_count), 0)::int
    from (
      select (
        select count(*)
        from ${documents}
        where ${documents.organizationId} = ${organizationId}
          and ${documents.entityType} = 'delivery'
          and ${documents.entityId} = ${deliveries.id}
          and ${documents.uploadStatus} = 'uploaded'
          and ${inArray(
            documents.documentType,
            [...TRANSPORT_EVIDENCE_DOCUMENT_TYPES],
          )}
      ) as accepted_count
      from ${deliveries}
      left join ${orders}
        on ${orders.id} = ${deliveries.orderId}
       and ${orders.organizationId} = ${organizationId}
      where ${deliveries.organizationId} = ${organizationId}
        and ${deliveries.status} = 'delivered'
        and ${deliveries.archivedAt} is null
        and coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId}) = ${biocharProductId}
    ) per_delivery
  )`;
}
