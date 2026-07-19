/**
 * Facility-scoped certification structure checks for the dashboard.
 *
 * These are deliberately separate from flow-station attention: GPS and
 * transport provenance are cross-cutting certification inputs, so they block
 * the dashboard's all-clear state without changing any station badge.
 */
import { and, count, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  creditBatches,
  facilities,
  feedstocks,
  productionRuns,
  samples,
  transportLegs,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

export interface DashboardStructuralGapCounts {
  missingFacilityGps: number;
  missingFeedstockGps: number;
  transportEndpointGpsGaps: number;
  transportDistanceEvidenceGaps: number;
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
  endpointGpsGaps: number;
  distanceEvidenceGaps: number;
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
};

function addTransportGapRows(rows: TransportGapRow[]): TransportGapRow {
  return rows.reduce(
    (total, row) => ({
      endpointGpsGaps: total.endpointGpsGaps + Number(row.endpointGpsGaps ?? 0),
      distanceEvidenceGaps:
        total.distanceEvidenceGaps + Number(row.distanceEvidenceGaps ?? 0),
    }),
    { endpointGpsGaps: 0, distanceEvidenceGaps: 0 },
  );
}

export function buildDashboardStructuralGaps(
  counts: DashboardStructuralGapCounts,
  facilityId: string,
): DashboardStructuralGap[] {
  const facilityQuery = `?facility=${encodeURIComponent(facilityId)}`;
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
      href: `/feedstocks${facilityQuery}`,
    },
    {
      key: "transportEndpointGps" as const,
      label: "Transport endpoint GPS missing",
      count: counts.transportEndpointGpsGaps,
      href: `/chain-of-custody${facilityQuery}`,
    },
    {
      key: "transportDistanceEvidence" as const,
      label: "Transport distance lacks document evidence",
      count: counts.transportDistanceEvidenceGaps,
      href: `/chain-of-custody${facilityQuery}`,
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
      .select({ count: count() })
      .from(feedstocks)
      .where(
        and(
          eq(feedstocks.organizationId, orgId),
          eq(feedstocks.facilityId, facilityId),
          isNull(feedstocks.archivedAt),
          or(isNull(feedstocks.gpsLatitude), isNull(feedstocks.gpsLongitude)),
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
              eq(productionRuns.facilityId, facilityId),
              isNull(productionRuns.archivedAt),
            ),
            and(
              eq(creditBatches.facilityId, facilityId),
              isNull(creditBatches.archivedAt),
            ),
          ),
        ),
      ),
  ]);

  const transport = addTransportGapRows([
    feedstockTransport,
    biocharTransport,
    sampleTransport,
  ]);

  return {
    missingFacilityGps: Number(facilityGps?.count ?? 0),
    missingFeedstockGps: Number(feedstockGps?.count ?? 0),
    transportEndpointGpsGaps: transport.endpointGpsGaps,
    transportDistanceEvidenceGaps: transport.distanceEvidenceGaps,
  };
}
