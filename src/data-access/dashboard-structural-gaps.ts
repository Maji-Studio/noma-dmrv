/**
 * Facility-scoped certification structure checks for the dashboard.
 *
 * These are deliberately separate from flow-station attention: GPS and
 * transport provenance are cross-cutting certification inputs, so they block
 * the dashboard's all-clear state without changing any station badge.
 */
import { and, count, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  customerLocations,
  creditBatches,
  deliveries,
  facilities,
  feedstocks,
  orders,
  productionRuns,
  samples,
  supplierLocations,
  suppliers,
  transportLegs,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { CANCELLED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { requireOrgScope } from "./utils";
import { DOCUMENT_BACKED_DISTANCE_SOURCE } from "@/lib/certification/transport-evidence";
import {
  buildEntityDeepLink,
  type EntityFocusTarget,
  ENTITY_FOCUS_TARGETS,
} from "@/lib/entity-deep-link";

export interface DashboardStructuralGapCounts {
  missingFacilityGps: number;
  missingFeedstockGps: number;
  transportEndpointGpsGaps: number;
  transportDistanceEvidenceGaps: number;
  missingFeedstockGpsSupplierId: string | null;
  transportEndpointGpsTarget: TransportGapTarget | null;
  transportDistanceEvidenceTarget: TransportGapTarget | null;
}

export interface TransportGapTarget {
  entityType: "feedstock" | "biochar" | "sample" | "delivery";
  entityId: string;
}

export type DashboardStructuralGapKey =
  | "facilityGps"
  | "feedstockGps"
  | "transportEndpointGps"
  | "transportDistanceEvidence";

export interface DashboardStructuralGap {
  key: DashboardStructuralGapKey;
  label: string;
  count: number;
  href: string;
}

interface TransportGapRow {
  entityType: Exclude<TransportGapTarget["entityType"], "delivery">;
  endpointGpsGaps: number;
  distanceEvidenceGaps: number;
  endpointGpsTargetId: string | null;
  distanceEvidenceTargetId: string | null;
}

const transportGapSelection = {
  endpointGpsGaps: sql<number>`count(*) filter (where
    ${transportLegs.originGpsLatitude} is null
    or ${transportLegs.originGpsLongitude} is null
    or ${transportLegs.destinationGpsLatitude} is null
    or ${transportLegs.destinationGpsLongitude} is null
  )::int`,
  distanceEvidenceGaps: sql<number>`count(*) filter (where
    ${transportLegs.distanceSource} is null
    or ${transportLegs.distanceSource} <> ${DOCUMENT_BACKED_DISTANCE_SOURCE}
  )::int`,
  endpointGpsTargetId: sql<string | null>`min(${transportLegs.entityId}::text) filter (where
    ${transportLegs.originGpsLatitude} is null
    or ${transportLegs.originGpsLongitude} is null
    or ${transportLegs.destinationGpsLatitude} is null
    or ${transportLegs.destinationGpsLongitude} is null
  )`,
  distanceEvidenceTargetId: sql<string | null>`min(${transportLegs.entityId}::text) filter (where
    ${transportLegs.distanceSource} is null
    or ${transportLegs.distanceSource} <> ${DOCUMENT_BACKED_DISTANCE_SOURCE}
  )`,
};

function addTransportGapRows(rows: TransportGapRow[]) {
  return {
    endpointGpsGaps: rows.reduce(
      (total, row) => total + Number(row.endpointGpsGaps ?? 0),
      0,
    ),
    distanceEvidenceGaps: rows.reduce(
      (total, row) => total + Number(row.distanceEvidenceGaps ?? 0),
      0,
    ),
    endpointGpsTarget: resolveTransportGapTarget(rows, "endpointGpsTargetId"),
    distanceEvidenceTarget: resolveTransportGapTarget(
      rows,
      "distanceEvidenceTargetId",
    ),
  };
}

function resolveTransportGapTarget(
  rows: TransportGapRow[],
  key: "endpointGpsTargetId" | "distanceEvidenceTargetId",
): TransportGapTarget | null {
  const row = rows.find((candidate) => candidate[key] != null);
  return row?.[key]
    ? { entityType: row.entityType, entityId: row[key] }
    : null;
}

function parentEditorHref(
  facilityId: string,
  target: TransportGapTarget | null,
  focus: EntityFocusTarget,
): string {
  const params = new URLSearchParams({ facility: facilityId });
  if (!target) return `/feedstocks?${params.toString()}`;

  const targetRoutes = {
    feedstock: { path: "/feedstocks", queryKey: "feedstock" },
    biochar: { path: "/biochar-products", queryKey: "biocharProduct" },
    sample: { path: "/samples", queryKey: "sample" },
    delivery: { path: "/deliveries", queryKey: "delivery" },
  } as const;
  const route = targetRoutes[target.entityType];
  return buildEntityDeepLink({
    path: route.path,
    facilityId,
    entityQueryKey: route.queryKey,
    entityId: target.entityId,
    focus,
  });
}

export function buildDashboardStructuralGaps(
  counts: DashboardStructuralGapCounts,
  facilityId: string,
): DashboardStructuralGap[] {
  const facilityParams = new URLSearchParams({ facility: facilityId });
  const facilityQuery = `?${facilityParams.toString()}`;
  const supplierHref = counts.missingFeedstockGpsSupplierId
    ? `/suppliers/${counts.missingFeedstockGpsSupplierId}${facilityQuery}`
    : `/suppliers${facilityQuery}`;
  return [
    {
      key: "facilityGps" as const,
      label: "Facility GPS missing",
      count: counts.missingFacilityGps,
      href: `/facilities${facilityQuery}`,
    },
    {
      key: "feedstockGps" as const,
      label: "Feedstock GPS missing",
      count: counts.missingFeedstockGps,
      href: supplierHref,
    },
    {
      key: "transportEndpointGps" as const,
      label: "Transport endpoint GPS missing",
      count: counts.transportEndpointGpsGaps,
      href: parentEditorHref(
        facilityId,
        counts.transportEndpointGpsTarget,
        ENTITY_FOCUS_TARGETS.transportRoute,
      ),
    },
    {
      key: "transportDistanceEvidence" as const,
      label: "Transport distance lacks document evidence",
      count: counts.transportDistanceEvidenceGaps,
      href: parentEditorHref(
        facilityId,
        counts.transportDistanceEvidenceTarget,
        ENTITY_FOCUS_TARGETS.transportEvidence,
      ),
    },
  ].filter((gap) => gap.count > 0);
}

/**
 * Count the four structural certification gaps for one active facility.
 * Transport legs are resolved through their polymorphic active parent so an
 * archived feedstock, product, run, or credit batch cannot keep a stale gap
 * alive. Every leg and parent predicate is organization-scoped.
 */
export async function loadDashboardStructuralGapCounts(
  ctx: OrgContext,
  facilityId: string,
): Promise<DashboardStructuralGapCounts> {
  requireOrgScope(ctx);

  const orgId = ctx.organizationId;
  const [
    [facilityGps],
    [feedstockGps],
    [feedstockTransport],
    [biocharTransport],
    [sampleTransport],
  ] = await Promise.all([
    db
      .select({ count: count() })
      .from(facilities)
      .where(
        and(
          eq(facilities.id, facilityId),
          eq(facilities.organizationId, orgId),
          isNull(facilities.archivedAt),
          or(isNull(facilities.gpsLatitude), isNull(facilities.gpsLongitude)),
        ),
      ),
    db
      .select({
        count: count(),
        supplierId: sql<string | null>`min(${feedstocks.supplierId}::text)`,
      })
      .from(feedstocks)
      .leftJoin(
        suppliers,
        and(
          eq(feedstocks.supplierId, suppliers.id),
          eq(suppliers.organizationId, orgId),
        ),
      )
      .leftJoin(
        supplierLocations,
        and(
          eq(supplierLocations.supplierId, suppliers.id),
          eq(supplierLocations.isDefault, true),
          eq(supplierLocations.organizationId, orgId),
        ),
      )
      .where(
        and(
          eq(feedstocks.organizationId, orgId),
          eq(feedstocks.facilityId, facilityId),
          isNull(feedstocks.archivedAt),
          or(
            isNull(supplierLocations.gpsLatitude),
            isNull(supplierLocations.gpsLongitude),
          ),
          or(isNull(suppliers.gpsLatitude), isNull(suppliers.gpsLongitude)),
        ),
      ),
    db
      .select(transportGapSelection)
      .from(transportLegs)
      .innerJoin(
        feedstocks,
        and(
          eq(transportLegs.entityType, "feedstock"),
          eq(transportLegs.entityId, feedstocks.id),
          eq(feedstocks.organizationId, orgId),
        ),
      )
      .where(
        and(
          eq(transportLegs.organizationId, orgId),
          eq(feedstocks.facilityId, facilityId),
          isNull(feedstocks.archivedAt),
        ),
      ),
    db
      .select(transportGapSelection)
      .from(transportLegs)
      .innerJoin(
        biocharProducts,
        and(
          eq(transportLegs.entityType, "biochar"),
          eq(transportLegs.entityId, biocharProducts.id),
          eq(biocharProducts.organizationId, orgId),
        ),
      )
      .where(
        and(
          eq(transportLegs.organizationId, orgId),
          eq(biocharProducts.facilityId, facilityId),
          isNull(biocharProducts.archivedAt),
        ),
      ),
    db
      .select(transportGapSelection)
      .from(transportLegs)
      .innerJoin(
        samples,
        and(
          eq(transportLegs.entityType, "sample"),
          eq(transportLegs.entityId, samples.id),
          eq(samples.organizationId, orgId),
        ),
      )
      .leftJoin(
        productionRuns,
        and(
          eq(samples.productionRunId, productionRuns.id),
          eq(productionRuns.organizationId, orgId),
        ),
      )
      .leftJoin(
        creditBatches,
        and(
          eq(samples.creditBatchId, creditBatches.id),
          eq(creditBatches.organizationId, orgId),
        ),
      )
      .where(
        and(
          eq(transportLegs.organizationId, orgId),
          or(
            and(
              isNotNull(samples.creditBatchId),
              eq(creditBatches.facilityId, facilityId),
              isNull(creditBatches.archivedAt),
            ),
            and(
              isNull(samples.creditBatchId),
              eq(productionRuns.facilityId, facilityId),
              isNull(productionRuns.archivedAt),
              ne(productionRuns.status, CANCELLED_PRODUCTION_RUN_STATUS),
            ),
          ),
        ),
      ),
  ]);

  const transport = addTransportGapRows([
    { ...feedstockTransport, entityType: "feedstock" },
    { ...biocharTransport, entityType: "biochar" },
    { ...sampleTransport, entityType: "sample" },
  ]);
  let distanceEvidenceTarget = transport.distanceEvidenceTarget;
  if (distanceEvidenceTarget?.entityType === "biochar") {
    const [deliveryTarget] = await db
      .select({ id: deliveries.id })
      .from(deliveries)
      .leftJoin(
        orders,
        and(
          eq(deliveries.orderId, orders.id),
          eq(orders.organizationId, orgId),
        ),
      )
      .leftJoin(
        customerLocations,
        and(
          eq(
            customerLocations.id,
            sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`,
          ),
          eq(customerLocations.organizationId, orgId),
        ),
      )
      .where(
        and(
          eq(deliveries.organizationId, orgId),
          eq(deliveries.facilityId, facilityId),
          isNull(deliveries.archivedAt),
          eq(deliveries.status, "delivered"),
          eq(
            sql`coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
            distanceEvidenceTarget.entityId,
          ),
          sql`case
            when ${deliveries.distanceKmOverride} > 0
              then coalesce(${deliveries.distanceSource}, 'manual') <> ${DOCUMENT_BACKED_DISTANCE_SOURCE}
            else ${customerLocations.distanceSource} is null
              or ${customerLocations.distanceSource} <> ${DOCUMENT_BACKED_DISTANCE_SOURCE}
          end`,
        ),
      )
      .limit(1);

    if (deliveryTarget) {
      distanceEvidenceTarget = {
        entityType: "delivery",
        entityId: deliveryTarget.id,
      };
    }
  }

  return {
    missingFacilityGps: Number(facilityGps?.count ?? 0),
    missingFeedstockGps: Number(feedstockGps?.count ?? 0),
    transportEndpointGpsGaps: transport.endpointGpsGaps,
    transportDistanceEvidenceGaps: transport.distanceEvidenceGaps,
    missingFeedstockGpsSupplierId: feedstockGps?.supplierId ?? null,
    transportEndpointGpsTarget: transport.endpointGpsTarget,
    transportDistanceEvidenceTarget: distanceEvidenceTarget,
  };
}
