/**
 * Facility-scoped certification structure checks for the dashboard.
 *
 * GPS is a cross-cutting certification input, so each gap is one grouped row
 * in Needs attention (one form section fixes every affected record) and also
 * lights the flow station its records belong to: supplier locations on
 * Suppliers, feedstock routes on Feedstock, biochar distribution routes on
 * Delivery (#1532 F5).
 */
import { recordHref } from "@/lib/record-links";
import {
  and,
  count,
  eq,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { countRows } from "@/db/aggregate";
import {
  biocharProducts,
  feedstocks,
  supplierLocations,
  suppliers,
  transportLegs,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";
import {
  type EntityFocusTarget,
  ENTITY_FOCUS_TARGETS,
} from "@/lib/entity-deep-link";
import type { DashboardStationKey } from "./dashboard-stations";

type TransportGapEntityType = "feedstock" | "biochar";

export interface DashboardStructuralGapCounts {
  missingFeedstockGps: number;
  missingFeedstockGpsSupplierId: string | null;
  /** Feedstock transport legs missing an endpoint GPS, and the first parent. */
  feedstockRouteGpsGaps: number;
  feedstockRouteGpsTargetId: string | null;
  /** Biochar distribution legs missing an endpoint GPS, and the first parent product. */
  biocharRouteGpsGaps: number;
  biocharRouteGpsTargetId: string | null;
}

export type DashboardStructuralGapKey =
  | "supplierGps"
  | "feedstockRouteGps"
  | "deliveryRouteGps";

export interface DashboardStructuralGap {
  key: DashboardStructuralGapKey;
  label: string;
  metadata: string;
  count: number;
  href: string;
  /** The flow station whose records the gap belongs to. */
  station: DashboardStationKey;
  /** Station reason text, e.g. "3 routes missing GPS". */
  stationReason: string;
}

const ENDPOINT_GPS_MISSING = sql`(
    ${transportLegs.originGpsLatitude} is null
    or ${transportLegs.originGpsLongitude} is null
    or ${transportLegs.destinationGpsLatitude} is null
    or ${transportLegs.destinationGpsLongitude} is null
  )`;

function transportGapSelection(entityType: TransportGapEntityType) {
  const gapOfType = and(
    eq(transportLegs.entityType, entityType),
    ENDPOINT_GPS_MISSING,
  );
  return {
    endpointGpsGaps: countRows(gapOfType),
    endpointGpsTargetId: sql<string | null>`min(${transportLegs.entityId}::text) filter (where ${gapOfType})`,
  };
}

function routeEditorHref(
  facilityId: string,
  entityType: TransportGapEntityType,
  targetId: string | null,
  focus: EntityFocusTarget,
): string {
  const params = new URLSearchParams({ facility: facilityId });
  if (!targetId) {
    const listPath = entityType === "feedstock" ? "/feedstock-intake" : "/biochar-products";
    return `${listPath}?${params.toString()}`;
  }
  return recordHref(entityType === "feedstock" ? "feedstock" : "biocharProduct", targetId, { facilityId, mode: "edit", focus });
}

function structuralGapMetadata(
  form: string,
  section: string,
  count: number,
): string {
  return `${form} · ${section} · ${count} affected`;
}

function plural(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}

export function buildDashboardStructuralGaps(
  counts: DashboardStructuralGapCounts,
  facilityId: string,
): DashboardStructuralGap[] {
  const facilityParams = new URLSearchParams({ facility: facilityId });
  const facilityQuery = `?${facilityParams.toString()}`;
  const supplierHref = counts.missingFeedstockGpsSupplierId
    ? recordHref("supplier", counts.missingFeedstockGpsSupplierId, { facilityId, mode: "edit" })
    : `/suppliers${facilityQuery}`;
  const gaps: DashboardStructuralGap[] = [
    {
      key: "supplierGps",
      label: "Supplier location GPS missing",
      metadata: structuralGapMetadata("Supplier form", "Location", counts.missingFeedstockGps),
      count: counts.missingFeedstockGps,
      href: supplierHref,
      station: "suppliers",
      stationReason: `${plural(counts.missingFeedstockGps, "feedstock")} without supplier GPS`,
    },
    {
      key: "feedstockRouteGps",
      label: "Feedstock route GPS missing",
      metadata: structuralGapMetadata("Feedstock form", "Transport route", counts.feedstockRouteGpsGaps),
      count: counts.feedstockRouteGpsGaps,
      href: routeEditorHref(facilityId, "feedstock", counts.feedstockRouteGpsTargetId, ENTITY_FOCUS_TARGETS.transportRoute),
      station: "feedstock",
      stationReason: `${plural(counts.feedstockRouteGpsGaps, "route")} missing GPS`,
    },
    {
      key: "deliveryRouteGps",
      label: "Delivery route GPS missing",
      metadata: structuralGapMetadata("Biochar product form", "Transport route", counts.biocharRouteGpsGaps),
      count: counts.biocharRouteGpsGaps,
      href: routeEditorHref(facilityId, "biochar", counts.biocharRouteGpsTargetId, ENTITY_FOCUS_TARGETS.transportRoute),
      station: "deliveries",
      stationReason: `${plural(counts.biocharRouteGpsGaps, "route")} missing GPS`,
    },
  ];
  return gaps.filter((gap) => gap.count > 0);
}

/**
 * Count the structural certification gaps for one active facility.
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
  const [[feedstockGps], [transportRow]] = await Promise.all([
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
        ),
      ),
    // One pass over the facility's legs: each parent type is a left join
    // keyed on its entity type, and the row filter keeps a leg only when its
    // own parent is active at this facility.
    db
      .select({
        feedstock: transportGapSelection("feedstock"),
        biochar: transportGapSelection("biochar"),
      })
      .from(transportLegs)
      .leftJoin(
        feedstocks,
        and(
          eq(transportLegs.entityType, "feedstock"),
          eq(transportLegs.entityId, feedstocks.id),
          eq(feedstocks.organizationId, orgId),
        ),
      )
      .leftJoin(
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
          or(
            and(
              eq(feedstocks.facilityId, facilityId),
              isNull(feedstocks.archivedAt),
            ),
            and(
              eq(biocharProducts.facilityId, facilityId),
              isNull(biocharProducts.archivedAt),
            ),
          ),
        ),
      ),
  ]);

  return {
    missingFeedstockGps: Number(feedstockGps?.count ?? 0),
    missingFeedstockGpsSupplierId: feedstockGps?.supplierId ?? null,
    feedstockRouteGpsGaps: Number(transportRow.feedstock.endpointGpsGaps ?? 0),
    feedstockRouteGpsTargetId: transportRow.feedstock.endpointGpsTargetId ?? null,
    biocharRouteGpsGaps: Number(transportRow.biochar.endpointGpsGaps ?? 0),
    biocharRouteGpsTargetId: transportRow.biochar.endpointGpsTargetId ?? null,
  };
}
