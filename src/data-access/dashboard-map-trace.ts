/**
 * Dashboard map trace — the facility's plottable sites and the directional legs
 * between them, powering the dashboard Traceability map. Split out of
 * `dashboard-operations.ts` to keep that module under the line cap.
 *
 * Sites: the facility hub, its feedstock sources, and its application fields
 * (own GPS only — ungeolocated records are surfaced as evidence gaps, not
 * faked onto the map). Legs: inbound feedstock → facility (orange) and outbound
 * facility → application field (pink). Each point and leg carries its popup
 * detail rows plus an href so the operator can navigate straight from the map.
 *
 * Facility-scoped and read-only; `getDashboardOperations` calls the auth guard
 * before reaching here.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  deliveries,
  facilities,
  feedstocks,
  transportLegs,
} from "@/db/schema";

export type DashboardMapKind = "facility" | "application" | "feedstock";

/** A label/value row shown inside a map popup card. */
export interface DashboardMapDetail {
  label: string;
  value: string;
}

export interface DashboardMapPoint {
  id: string;
  kind: DashboardMapKind;
  /** Marker title (entity code / facility name). */
  label: string;
  /** Secondary line (status / kind context). */
  sublabel: string;
  lat: number;
  lng: number;
  /** Where the popup's "open record" link navigates. */
  href: string;
  /** Popup card label/value rows. */
  details: DashboardMapDetail[];
}

/**
 * A directional traceability edge between two plotted points — the trace flow
 * the operator follows on the map. Inbound = feedstock → facility; outbound =
 * facility → application field.
 */
export interface DashboardMapEdge {
  id: string;
  kind: "inbound" | "outbound";
  /** Point id the leg leaves from. */
  fromId: string;
  /** Point id the leg arrives at. */
  toId: string;
  /** Mono label shown in the leg popup (e.g. "Feedstock haul"). */
  label: string;
  /** Stored transport distance (km) when known; null = not recorded. */
  distanceKm: number | null;
  /** Where the leg popup's "trace" link navigates (chain-of-custody / list). */
  href: string;
}

/** Cap per source — the dashboard map is an overview, not the custody viewer. */
const MAP_POINT_LIMIT = 60;

function facilityHref(path: string, facilityId: string): string {
  return `${path}?facility=${encodeURIComponent(facilityId)}`;
}

function chainOfCustodyApplicationHref(applicationId: string): string {
  return `/chain-of-custody?application=${encodeURIComponent(applicationId)}`;
}

/** Coerce a (numeric|string) lat/lng pair to finite numbers, dropping 0,0. */
function coordPair(lat: unknown, lng: unknown): [number, number] | null {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la === 0 && ln === 0) return null;
  return [la, ln];
}

/** "missing_data" → "Missing data" for popup status rows. */
function prettyStatus(status: string): string {
  const spaced = status.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Total stored road distance (km) per feedstock, summed across its legs. */
async function loadFeedstockLegDistances(
  facilityId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      feedstockId: transportLegs.entityId,
      distanceKm: sql<number>`sum(${transportLegs.distanceKm})::float`,
    })
    .from(transportLegs)
    .innerJoin(
      feedstocks,
      and(
        eq(transportLegs.entityType, "feedstock"),
        eq(transportLegs.entityId, feedstocks.id),
      ),
    )
    .where(and(eq(feedstocks.facilityId, facilityId), isNull(feedstocks.archivedAt)))
    .groupBy(transportLegs.entityId);
  return new Map(rows.map((row) => [row.feedstockId, Number(row.distanceKm ?? 0)]));
}

export async function loadMapTrace(
  facilityId: string,
): Promise<{ points: DashboardMapPoint[]; edges: DashboardMapEdge[] }> {
  const [facilityRows, applicationRows, feedstockRows, feedstockDistances] =
    await Promise.all([
      db
        .select({
          id: facilities.id,
          code: facilities.code,
          name: facilities.name,
          lat: facilities.gpsLatitude,
          lng: facilities.gpsLongitude,
        })
        .from(facilities)
        .where(eq(facilities.id, facilityId))
        .limit(1),
      db
        .select({
          id: applications.id,
          code: applications.code,
          status: applications.status,
          lat: applications.gpsLatitude,
          lng: applications.gpsLongitude,
        })
        .from(applications)
        .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
        .where(and(eq(deliveries.facilityId, facilityId), isNull(deliveries.archivedAt)))
        .orderBy(desc(applications.applicationDate))
        .limit(MAP_POINT_LIMIT),
      db
        .select({
          id: feedstocks.id,
          code: feedstocks.code,
          status: feedstocks.status,
          lat: feedstocks.gpsLatitude,
          lng: feedstocks.gpsLongitude,
        })
        .from(feedstocks)
        .where(and(eq(feedstocks.facilityId, facilityId), isNull(feedstocks.archivedAt)))
        .orderBy(desc(feedstocks.deliveryDate))
        .limit(MAP_POINT_LIMIT),
      loadFeedstockLegDistances(facilityId),
    ]);

  const points: DashboardMapPoint[] = [];
  const edges: DashboardMapEdge[] = [];

  // The facility is the hub every leg pivots around — resolve it first so the
  // inbound/outbound edges have an anchor. No facility GPS ⇒ no legs (which
  // also surfaces as the "facility GPS missing" evidence gap).
  const facility = facilityRows[0];
  let facilityPointId: string | null = null;
  if (facility) {
    const coord = coordPair(facility.lat, facility.lng);
    if (coord) {
      facilityPointId = `facility-${facility.id}`;
      points.push({
        id: facilityPointId,
        kind: "facility",
        label: facility.name,
        sublabel: `Facility · ${facility.code}`,
        lat: coord[0],
        lng: coord[1],
        href: facilityHref("/facilities", facilityId),
        details: [{ label: "Code", value: facility.code }],
      });
    }
  }

  for (const row of feedstockRows) {
    const coord = coordPair(row.lat, row.lng);
    if (!coord) continue;
    const pointId = `feedstock-${row.id}`;
    const distanceKm = feedstockDistances.get(row.id) ?? null;
    points.push({
      id: pointId,
      kind: "feedstock",
      label: row.code,
      sublabel: `Feedstock · ${prettyStatus(row.status)}`,
      lat: coord[0],
      lng: coord[1],
      href: facilityHref("/feedstocks", facilityId),
      details: [
        { label: "Status", value: prettyStatus(row.status) },
        ...(distanceKm && distanceKm > 0
          ? [{ label: "Haul", value: `${Math.round(distanceKm)} km` }]
          : []),
      ],
    });
    if (facilityPointId) {
      edges.push({
        id: `inbound-${row.id}`,
        kind: "inbound",
        fromId: pointId,
        toId: facilityPointId,
        label: "Feedstock haul",
        distanceKm: distanceKm && distanceKm > 0 ? distanceKm : null,
        href: facilityHref("/feedstocks", facilityId),
      });
    }
  }

  for (const row of applicationRows) {
    const coord = coordPair(row.lat, row.lng);
    if (!coord) continue;
    const pointId = `application-${row.id}`;
    points.push({
      id: pointId,
      kind: "application",
      label: row.code,
      sublabel: `Application · ${prettyStatus(row.status)}`,
      lat: coord[0],
      lng: coord[1],
      href: chainOfCustodyApplicationHref(row.id),
      details: [{ label: "Status", value: prettyStatus(row.status) }],
    });
    if (facilityPointId) {
      edges.push({
        id: `outbound-${row.id}`,
        kind: "outbound",
        fromId: facilityPointId,
        toId: pointId,
        label: "Biochar to field",
        distanceKm: null,
        href: chainOfCustodyApplicationHref(row.id),
      });
    }
  }

  return { points, edges };
}
