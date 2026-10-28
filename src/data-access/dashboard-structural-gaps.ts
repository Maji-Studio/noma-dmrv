/**
 * Facility-scoped certification structure checks for the dashboard.
 *
 * These are deliberately separate from flow-station attention: GPS is a
 * cross-cutting certification input, so it blocks the dashboard's all-clear
 * state without changing any station badge.
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

export interface DashboardStructuralGapCounts {
  missingFeedstockGps: number;
  transportEndpointGpsGaps: number;
  missingFeedstockGpsSupplierId: string | null;
  transportEndpointGpsTarget: TransportGapTarget | null;
}

export interface TransportGapTarget {
  entityType: "feedstock" | "biochar";
  entityId: string;
}

export type DashboardStructuralGapKey =
  | "feedstockGps"
  | "transportEndpointGps";

export interface DashboardStructuralGap {
  key: DashboardStructuralGapKey;
  label: string;
  metadata: string;
  count: number;
  href: string;
}

interface TransportGapRow {
  entityType: TransportGapTarget["entityType"];
  endpointGpsGaps: number;
  endpointGpsTargetId: string | null;
}

const ENDPOINT_GPS_MISSING = sql`(
    ${transportLegs.originGpsLatitude} is null
    or ${transportLegs.originGpsLongitude} is null
    or ${transportLegs.destinationGpsLatitude} is null
    or ${transportLegs.destinationGpsLongitude} is null
  )`;

function transportGapSelection(entityType: TransportGapTarget["entityType"]) {
  const gapOfType = and(
    eq(transportLegs.entityType, entityType),
    ENDPOINT_GPS_MISSING,
  );
  return {
    endpointGpsGaps: countRows(gapOfType),
    endpointGpsTargetId: sql<string | null>`min(${transportLegs.entityId}::text) filter (where ${gapOfType})`,
  };
}

function addTransportGapRows(rows: TransportGapRow[]) {
  return {
    endpointGpsGaps: rows.reduce(
      (total, row) => total + Number(row.endpointGpsGaps ?? 0),
      0,
    ),
    endpointGpsTarget: resolveTransportGapTarget(rows),
  };
}

function resolveTransportGapTarget(
  rows: TransportGapRow[],
): TransportGapTarget | null {
  const row = rows.find((candidate) => candidate.endpointGpsTargetId != null);
  return row?.endpointGpsTargetId
    ? { entityType: row.entityType, entityId: row.endpointGpsTargetId }
    : null;
}

function parentEditorHref(
  facilityId: string,
  target: TransportGapTarget | null,
  focus: EntityFocusTarget,
): string {
  const params = new URLSearchParams({ facility: facilityId });
  if (!target) return `/feedstock-intake?${params.toString()}`;

  return recordHref(target.entityType === "feedstock" ? "feedstock" : "biocharProduct", target.entityId, { facilityId, mode: "edit", focus });
}

function transportTargetForm(target: TransportGapTarget | null): string {
  const formNames: Record<TransportGapTarget["entityType"], string> = {
    feedstock: "Feedstock form",
    biochar: "Biochar product form",
  };
  return formNames[target?.entityType ?? "feedstock"];
}

function structuralGapMetadata(
  form: string,
  section: string,
  count: number,
): string {
  return `${form} · ${section} · ${count} affected`;
}

export function buildDashboardStructuralGaps(
  counts: DashboardStructuralGapCounts,
  facilityId: string,
): DashboardStructuralGap[] {
  const facilityParams = new URLSearchParams({ facility: facilityId });
  const facilityQuery = `?${facilityParams.toString()}`;
  const supplierHref = counts.missingFeedstockGpsSupplierId
    ? recordHref("supplier", counts.missingFeedstockGpsSupplierId, { facilityId, preview: true, mode: "edit" })
    : `/suppliers${facilityQuery}`;
  return [
    {
      key: "feedstockGps" as const,
      label: "Feedstock GPS missing",
      metadata: structuralGapMetadata(
        "Supplier form",
        "Location",
        counts.missingFeedstockGps,
      ),
      count: counts.missingFeedstockGps,
      href: supplierHref,
    },
    {
      key: "transportEndpointGps" as const,
      label: "Transport endpoint GPS missing",
      metadata: structuralGapMetadata(
        transportTargetForm(counts.transportEndpointGpsTarget),
        "Transport route",
        counts.transportEndpointGpsGaps,
      ),
      count: counts.transportEndpointGpsGaps,
      href: parentEditorHref(
        facilityId,
        counts.transportEndpointGpsTarget,
        ENTITY_FOCUS_TARGETS.transportRoute,
      ),
    },
  ].filter((gap) => gap.count > 0);
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

  const transport = addTransportGapRows([
    { ...transportRow.feedstock, entityType: "feedstock" },
    { ...transportRow.biochar, entityType: "biochar" },
  ]);

  return {
    missingFeedstockGps: Number(feedstockGps?.count ?? 0),
    transportEndpointGpsGaps: transport.endpointGpsGaps,
    missingFeedstockGpsSupplierId: feedstockGps?.supplierId ?? null,
    transportEndpointGpsTarget: transport.endpointGpsTarget,
  };
}
