import type { OrgContext } from "@/lib/auth/server";
import { TRANSPORT_EVIDENCE_DOCUMENT_TYPES } from "@/lib/certification/transport-evidence";
import { is, sql, type SQLWrapper } from "drizzle-orm";
import { PgColumn } from "drizzle-orm/pg-core";
import { requireOrgScope } from "./utils";

type TransportEvidenceEntityReference =
  | "deliveryId"
  | "feedstockId"
  | "transportLegId"
  | "transportLegEntityId";

const QUALIFIED_ENTITY_ID: Record<TransportEvidenceEntityReference, string> = {
  deliveryId: '"deliveries"."id"',
  feedstockId: '"feedstocks"."id"',
  transportLegId: '"transport_legs"."id"',
  transportLegEntityId: '"transport_legs"."entity_id"',
};

/** Correlated, org-scoped count that does not multiply the parent query. */
export function transportEvidenceDocumentCount(
  organizationId: string,
  entityType: "feedstock" | "delivery" | "transport_leg",
  entityReference: TransportEvidenceEntityReference,
) {
  const outerEntityId = sql.raw(QUALIFIED_ENTITY_ID[entityReference]);
  const docTypeList = sql.join(
    TRANSPORT_EVIDENCE_DOCUMENT_TYPES.map((docType) => sql`${docType}`),
    sql`, `,
  );

  // These identifiers are intentionally literal. Drizzle unqualifies
  // interpolated column references inside a raw correlated subquery, which
  // turns `documents.entity_id = outer_table.id` into an uncorrelated
  // comparison (or even `entity_id = entity_id`). Keep the outer references
  // limited to the validated map above.
  return sql<number>`(
    select count(*)::int
    from documents
    where documents.organization_id = ${organizationId}
      and documents.entity_type = ${entityType}
      and documents.entity_id = ${outerEntityId}
      and documents.upload_status = 'uploaded'
      and documents.document_type in (${docTypeList})
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
 * dashboard's per-delivery evidence rule — a file on an archived
 * or sibling delivery must not turn the leg green. No contributing
 * deliveries → 0 (fails closed).
 */
export function biocharTransportEvidenceDocumentCount(
  ctx: OrgContext,
  biocharProductId: SQLWrapper,
) {
  requireOrgScope(ctx);
  const organizationId = ctx.organizationId;
  // A single-table Drizzle SELECT unqualifies interpolated columns even inside
  // subqueries. Build a table + identifier reference so an outer `id` cannot
  // accidentally bind to the delivery/allocation being scanned.
  const productReference = is(biocharProductId, PgColumn)
    ? sql`${biocharProductId.table}.${sql.identifier(biocharProductId.name)}`
    : biocharProductId;
  // Table/column names are written LITERALLY, not via `${table.column}`:
  // drizzle renders column references inside raw sql templates unqualified
  // when their table is absent from the outer query builder, and this
  // subquery joins two tables — unqualified `id`/`biochar_product_id` are
  // ambiguous (42702) or silently mis-bound. Only parameters and the outer
  // transport-leg column are interpolated.
  const docTypeList = sql.join(
    TRANSPORT_EVIDENCE_DOCUMENT_TYPES.map((docType) => sql`${docType}`),
    sql`, `,
  );
  return sql<number>`(
    select coalesce(min(per_delivery.accepted_count), 0)::int
    from (
      select (
        select count(*)
        from documents
        where documents.organization_id = ${organizationId}
          and documents.entity_type = 'delivery'
          and documents.entity_id = deliveries.id
          and documents.upload_status = 'uploaded'
          and documents.document_type in (${docTypeList})
      ) as accepted_count
      from deliveries
      left join orders
        on orders.id = deliveries.order_id
       and orders.organization_id = ${organizationId}
      where deliveries.organization_id = ${organizationId}
        and deliveries.status = 'delivered'
        and deliveries.archived_at is null
        and exists (
          select 1 from output_stock_allocations osa
          where osa.organization_id = ${organizationId}
            and osa.delivery_id = deliveries.id
            and osa.biochar_product_id = ${productReference}
          group by osa.delivery_id, osa.biochar_product_id
          having sum(osa.dry_mass_kg) > 0 or sum(osa.wet_mass_kg) > 0
        )
    ) per_delivery
  )`;
}
