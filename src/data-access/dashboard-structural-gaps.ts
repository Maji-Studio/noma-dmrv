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
  creditBatches,
  facilities,
  feedstocks,
  productionRuns,
  samples,
  supplierLocations,
  suppliers,
  transportLegs,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

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
  entityType: "feedstock" | "biochar" | "sample";
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
  entityType: TransportGapTarget["entityType"];
  endpointGpsGaps: number;
  distanceEvidenceGaps: number;
  endpointGpsTargetId: string | null;
  distanceEvidenceTargetId: string | null;
}

const DOCUMENT_BACKED_DISTANCE_SOURCE =
  "document" satisfies (typeof transportLegs.distanceSource.enumValues)[number];

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
): string {
  const params = new URLSearchParams({ facility: facilityId });
  if (!target) return `/feedstocks?${params.toString()}`;

  const targetRoutes = {
    feedstock: { path: "/feedstocks", queryKey: "feedstock" },
    biochar: { path: "/biochar-products", queryKey: "biocharProduct" },
    sample: { path: "/samples", queryKey: "sample" },
  } as const;
  const route = targetRoutes[target.entityType];
  params.set(route.queryKey, target.entityId);
  return `${route.path}?${params.toString()}`;
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
      href: parentEditorHref(facilityId, counts.transportEndpointGpsTarget),
    },
    {
      key: "transportDistanceEvidence" as const,
      label: "Transport distance lacks document evidence",
      count: counts.transportDistanceEvidenceGaps,
      href: parentEditorHref(
        facilityId,
        counts.transportDistanceEvidenceTarget,
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
              ne(productionRuns.status, "cancelled"),
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

  return {
    missingFacilityGps: Number(facilityGps?.count ?? 0),
    missingFeedstockGps: Number(feedstockGps?.count ?? 0),
    transportEndpointGpsGaps: transport.endpointGpsGaps,
    transportDistanceEvidenceGaps: transport.distanceEvidenceGaps,
    missingFeedstockGpsSupplierId: feedstockGps?.supplierId ?? null,
    transportEndpointGpsTarget: transport.endpointGpsTarget,
    transportDistanceEvidenceTarget: transport.distanceEvidenceTarget,
  };
}
