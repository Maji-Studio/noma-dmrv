/**
 * Chain of custody — geo payload (map-integration Phase 2).
 *
 * Sibling resolver to `getChainOfCustodyData`: reuses the same lineage
 * resolution, then extends every chain node with coordinates (own GPS,
 * leg-origin for feedstocks, or facility-inherited) and returns the chain's
 * transport legs with endpoint identity + distance provenance. The existing
 * `ChainOfCustodyData` payload carries no coordinates by design — this is the
 * explicit geo contract the Carbon Viewer map consumes (plan decision 6).
 */
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { applications, facilities, feedstocks, transportLegs } from "@/db/schema";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { requireAuth } from "./utils";
import {
  getChainOfCustodyData,
  type ChainOfCustodyData,
} from "./chain-of-custody";

export type ChainGeoNodeKind =
  | "facility"
  | "application"
  | "delivery"
  | "order"
  | "biocharProduct"
  | "productionRun"
  | "reactor"
  | "feedstock";

/** How a node's plotted position was resolved. */
export type ChainGeoPositionSource =
  /** The entity's own GPS columns. */
  | "own"
  /** Feedstock without own GPS — its inbound leg's origin (supplier side). */
  | "leg_origin"
  /** No own position — inherits the facility marker (rail: "not geolocated"). */
  | "facility"
  /** Nothing to inherit either (facility itself has no GPS). */
  | "none";

export interface ChainGeoNode {
  /** Same id convention as the lineage DAG (`kind:entityId`) for cross-linking. */
  id: string;
  kind: ChainGeoNodeKind;
  entityId: string;
  code: string;
  lat: number | null;
  lng: number | null;
  positionSource: ChainGeoPositionSource;
  inheritedFromFacility: boolean;
  /** Secondary marker label (supplier name, field identifier, …). */
  sub: string | null;
}

export interface ChainGeoLeg {
  id: string;
  /** Inbound = feedstock to facility; outbound = facility to customers. */
  kind: "inbound" | "outbound";
  entityType: "feedstock" | "biochar" | "sample";
  entityId: string;
  originName: string | null;
  originLat: number | null;
  originLng: number | null;
  destinationName: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  distanceKm: number;
  distanceSource: DistanceSourceValue | null;
  isDerived: boolean;
}

export interface ChainOfCustodyGeoData {
  facility: {
    id: string;
    code: string;
    name: string;
    lat: number | null;
    lng: number | null;
  };
  /** Every chain node except the facility, position-resolved. */
  nodes: ChainGeoNode[];
  legs: ChainGeoLeg[];
  /** Geo-specific warnings — lineage warnings stay on the base payload. */
  warnings: string[];
}

interface GpsPair {
  lat: number | null;
  lng: number | null;
}

export async function getChainOfCustodyGeoData(
  userId: string,
  applicationId: string
): Promise<ChainOfCustodyGeoData> {
  requireAuth(userId);

  const chain = await getChainOfCustodyData(userId, applicationId);
  const feedstockIds = chain.feedstocks.map((feedstock) => feedstock.id);

  const [facilityGps, applicationGps, feedstockGpsById, legs] = await Promise.all([
    getFacilityGps(chain.facility.id),
    getApplicationGps(chain.application.id),
    getFeedstockGps(feedstockIds),
    getChainLegs(feedstockIds, chain.biocharProduct?.id ?? null),
  ]);

  const warnings: string[] = [];
  const nodes = buildGeoNodes(chain, {
    facilityGps,
    applicationGps,
    feedstockGpsById,
    legs,
  });

  if (facilityGps.lat == null || facilityGps.lng == null) {
    warnings.push(
      "The facility has no GPS coordinates, so records without their own position cannot be plotted."
    );
  }

  const unplottableFeedstocks = nodes.filter(
    (node) => node.kind === "feedstock" && node.positionSource !== "own" && node.positionSource !== "leg_origin"
  );
  if (chain.feedstocks.length > 0 && unplottableFeedstocks.length === chain.feedstocks.length) {
    warnings.push(
      "Feedstock origins are not geolocated — upstream transport legs cannot be plotted."
    );
  }

  return {
    facility: {
      id: chain.facility.id,
      code: chain.facility.code,
      name: chain.facility.name,
      lat: facilityGps.lat,
      lng: facilityGps.lng,
    },
    nodes,
    legs,
    warnings,
  };
}

interface GeoNodeInputs {
  facilityGps: GpsPair;
  applicationGps: GpsPair;
  feedstockGpsById: Map<string, GpsPair>;
  legs: ChainGeoLeg[];
}

function buildGeoNodes(
  chain: ChainOfCustodyData,
  inputs: GeoNodeInputs
): ChainGeoNode[] {
  const { facilityGps, applicationGps, feedstockGpsById, legs } = inputs;
  const nodes: ChainGeoNode[] = [];

  const resolve = (
    kind: ChainGeoNodeKind,
    entityId: string,
    code: string,
    sub: string | null,
    own?: GpsPair | null,
    legOrigin?: GpsPair | null
  ): ChainGeoNode => {
    let lat: number | null = null;
    let lng: number | null = null;
    let positionSource: ChainGeoPositionSource = "none";

    if (own && own.lat != null && own.lng != null) {
      ({ lat, lng } = own);
      positionSource = "own";
    } else if (legOrigin && legOrigin.lat != null && legOrigin.lng != null) {
      ({ lat, lng } = legOrigin);
      positionSource = "leg_origin";
    } else if (facilityGps.lat != null && facilityGps.lng != null) {
      ({ lat, lng } = facilityGps);
      positionSource = "facility";
    }

    return {
      id: `${idPrefix(kind)}:${entityId}`,
      kind,
      entityId,
      code,
      lat,
      lng,
      positionSource,
      inheritedFromFacility: positionSource === "facility",
      sub,
    };
  };

  if (chain.reactor) {
    nodes.push(
      resolve("reactor", chain.reactor.id, chain.reactor.code, chain.reactor.identifier)
    );
  }

  for (const feedstock of chain.feedstocks) {
    const inboundLeg = legs.find(
      (leg) => leg.entityType === "feedstock" && leg.entityId === feedstock.id
    );
    nodes.push(
      resolve(
        "feedstock",
        feedstock.id,
        feedstock.code,
        feedstock.supplierName,
        feedstockGpsById.get(feedstock.id),
        inboundLeg ? { lat: inboundLeg.originLat, lng: inboundLeg.originLng } : null
      )
    );
  }

  if (chain.productionRun) {
    nodes.push(
      resolve("productionRun", chain.productionRun.id, chain.productionRun.code, null)
    );
  }
  if (chain.biocharProduct) {
    nodes.push(
      resolve("biocharProduct", chain.biocharProduct.id, chain.biocharProduct.code, null)
    );
  }
  if (chain.order) {
    nodes.push(resolve("order", chain.order.id, chain.order.code, null));
  }

  nodes.push(resolve("delivery", chain.delivery.id, chain.delivery.code, null));
  nodes.push(
    resolve(
      "application",
      chain.application.id,
      chain.application.code,
      chain.application.fieldIdentifier,
      applicationGps
    )
  );

  return nodes;
}

/** DAG node-id prefixes (`use-chain-graph.ts`) — kept in sync for cross-linking. */
function idPrefix(kind: ChainGeoNodeKind): string {
  switch (kind) {
    case "biocharProduct":
      return "biochar-product";
    case "productionRun":
      return "production-run";
    default:
      return kind;
  }
}

async function getFacilityGps(facilityId: string): Promise<GpsPair> {
  const [row] = await db
    .select({ lat: facilities.gpsLatitude, lng: facilities.gpsLongitude })
    .from(facilities)
    .where(eq(facilities.id, facilityId))
    .limit(1);
  return row ?? { lat: null, lng: null };
}

async function getApplicationGps(applicationId: string): Promise<GpsPair> {
  const [row] = await db
    .select({ lat: applications.gpsLatitude, lng: applications.gpsLongitude })
    .from(applications)
    .where(eq(applications.id, applicationId))
    .limit(1);
  return row ?? { lat: null, lng: null };
}

async function getFeedstockGps(feedstockIds: string[]): Promise<Map<string, GpsPair>> {
  if (feedstockIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      id: feedstocks.id,
      lat: feedstocks.gpsLatitude,
      lng: feedstocks.gpsLongitude,
    })
    .from(feedstocks)
    .where(inArray(feedstocks.id, feedstockIds));
  return new Map(rows.map((row) => [row.id, { lat: row.lat, lng: row.lng }]));
}

async function getChainLegs(
  feedstockIds: string[],
  biocharProductId: string | null
): Promise<ChainGeoLeg[]> {
  const conditions: SQL[] = [];
  if (feedstockIds.length > 0) {
    conditions.push(
      and(
        eq(transportLegs.entityType, "feedstock"),
        inArray(transportLegs.entityId, feedstockIds)
      )!
    );
  }
  if (biocharProductId) {
    conditions.push(
      and(
        eq(transportLegs.entityType, "biochar"),
        eq(transportLegs.entityId, biocharProductId)
      )!
    );
  }
  if (conditions.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      id: transportLegs.id,
      entityType: transportLegs.entityType,
      entityId: transportLegs.entityId,
      originName: transportLegs.originName,
      originLat: transportLegs.originGpsLatitude,
      originLng: transportLegs.originGpsLongitude,
      destinationName: transportLegs.destinationName,
      destinationLat: transportLegs.destinationGpsLatitude,
      destinationLng: transportLegs.destinationGpsLongitude,
      distanceKm: transportLegs.distanceKm,
      distanceSource: transportLegs.distanceSource,
      isDerived: transportLegs.isDerived,
    })
    .from(transportLegs)
    .where(or(...conditions));

  return rows.map((row) => ({
    ...row,
    kind: row.entityType === "feedstock" ? ("inbound" as const) : ("outbound" as const),
  }));
}
