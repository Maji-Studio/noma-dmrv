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
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import {
  applications,
  customerLocations,
  deliveries,
  facilities,
  feedstocks,
  orders,
  transportLegs,
} from "@/db/schema";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { requireOrgScope } from "./utils";
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
  /**
   * Cargo mass moving along the transport leg. Kept as the transport/emissions
   * basis even when an outbound application records a smaller applied mass.
   */
  loadMassKg: number | null;
  /** Wet biochar mass recorded as applied at the destination, in kg. */
  appliedWetMassKg: number | null;
  /**
   * What's moving: the feedstock type ("Coffee husk") for inbound, the biochar
   * formulation name (or "Biochar" when pure) for outbound. Drives the card's
   * material line. Enriched from the lineage in `getChainOfCustodyGeoData`.
   */
  materialLabel: string | null;
  /** Detail-page link for the leg's outer party (feedstock / application). */
  outerHref: string | null;
  /** Record code of the outer party (feedstock code / application code). */
  outerCode: string | null;
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
  ctx: OrgContext,
  applicationId: string
): Promise<ChainOfCustodyGeoData> {
  requireOrgScope(ctx);

  const chain = await getChainOfCustodyData(ctx, applicationId);
  return projectChainOfCustodyGeoData(ctx, chain);
}

export async function projectChainOfCustodyGeoData(
  ctx: OrgContext,
  chain: ChainOfCustodyData,
): Promise<ChainOfCustodyGeoData> {
  requireOrgScope(ctx);
  const feedstockIds = chain.feedstocks.map((feedstock) => feedstock.id);

  const [facilityGps, applicationGps, feedstockGpsById, feedstockLegs] = await Promise.all([
    getFacilityGps(ctx, chain.facility.id),
    getApplicationGps(ctx, chain.application.id),
    getFeedstockGps(ctx, feedstockIds),
    getFeedstockLegs(ctx, feedstockIds),
  ]);
  const outboundLegs = chain.biocharProduct
    ? await getApplicationBiocharLeg({
        ctx,
        applicationId: chain.application.id,
        deliveryId: chain.delivery.id,
        biocharProductId: chain.biocharProduct.id,
        facilityName: chain.facility.name,
        facilityGps,
      })
    : [];

  const legs = enrichLegs(chain, [...feedstockLegs, ...outboundLegs]);

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
      "Feedstock origins have no coordinates, so inbound transport legs cannot be plotted. Add coordinates to the supplier locations."
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

/**
 * Attach the rail-card fields (material moving along the leg + a detail link)
 * from the already-resolved lineage. Inbound legs key on the feedstock; the
 * card's mass is the leg's own `loadMassKg`.
 *
 * Outbound legs key on the biochar product, but are resolved per application
 * below rather than from the aggregate product-level transport leg.
 */
function enrichLegs(
  chain: ChainOfCustodyData,
  legs: ChainGeoLeg[]
): ChainGeoLeg[] {
  return legs.map((leg) => {
    if (leg.kind === "inbound") {
      const feedstock = chain.feedstocks.find((fs) => fs.id === leg.entityId);
      return {
        ...leg,
        materialLabel: feedstock?.feedstockTypeName ?? null,
        outerHref: feedstock?.href ?? null,
        outerCode: feedstock?.code ?? null,
      };
    }
    return {
      ...leg,
      materialLabel: chain.biocharProduct?.formulationName ?? "Biochar",
      outerHref: chain.application.href,
      outerCode: chain.application.code,
    };
  });
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

async function getFacilityGps(ctx: OrgContext, facilityId: string): Promise<GpsPair> {
  const [row] = await db
    .select({ lat: facilities.gpsLatitude, lng: facilities.gpsLongitude })
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .limit(1);
  return row ?? { lat: null, lng: null };
}

async function getApplicationGps(ctx: OrgContext, applicationId: string): Promise<GpsPair> {
  const [row] = await db
    .select({ lat: applications.gpsLatitude, lng: applications.gpsLongitude })
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.organizationId, ctx.organizationId)))
    .limit(1);
  return row ?? { lat: null, lng: null };
}

async function getFeedstockGps(ctx: OrgContext, feedstockIds: string[]): Promise<Map<string, GpsPair>> {
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
    .where(and(inArray(feedstocks.id, feedstockIds), eq(feedstocks.organizationId, ctx.organizationId)));
  return new Map(rows.map((row) => [row.id, { lat: row.lat, lng: row.lng }]));
}

function positiveOrNull(value: number | null): number | null {
  return value != null && value > 0 ? value : null;
}

async function getFeedstockLegs(
  ctx: OrgContext,
  feedstockIds: string[],
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
      loadMassKg: transportLegs.loadMassKg,
    })
    .from(transportLegs)
    .where(and(eq(transportLegs.organizationId, ctx.organizationId), or(...conditions)));

  return rows.map((row) => ({
    ...row,
    kind: row.entityType === "feedstock" ? ("inbound" as const) : ("outbound" as const),
    // Material / link / code are enriched from the lineage by the caller.
    appliedWetMassKg: null,
    materialLabel: null,
    outerHref: null,
    outerCode: null,
  }));
}

async function getApplicationBiocharLeg({
  ctx,
  applicationId,
  deliveryId,
  biocharProductId,
  facilityName,
  facilityGps,
}: {
  ctx: OrgContext;
  applicationId: string;
  deliveryId: string;
  biocharProductId: string;
  facilityName: string;
  facilityGps: GpsPair;
}): Promise<ChainGeoLeg[]> {
  const [row] = await db
    .select({
      loadMassKg: deliveries.deliveredWetMassKg,
      appliedWetMassTons: applications.biocharAppliedTons,
      deliveryDistanceKmOverride: deliveries.distanceKmOverride,
      deliveryDistanceSource: deliveries.distanceSource,
      locationDistanceKm: customerLocations.distanceFromFacilityKm,
      locationDistanceSource: customerLocations.distanceSource,
      locationName: customerLocations.name,
      locationGpsLatitude: customerLocations.gpsLatitude,
      locationGpsLongitude: customerLocations.gpsLongitude,
    })
    .from(deliveries)
    .innerJoin(
      applications,
      and(
        eq(applications.id, applicationId),
        eq(applications.deliveryId, deliveries.id),
        eq(applications.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(orders, and(eq(deliveries.orderId, orders.id), eq(orders.organizationId, ctx.organizationId)))
    .leftJoin(
      customerLocations,
      and(eq(customerLocations.id, sql`coalesce(${deliveries.customerLocationId}, ${orders.customerLocationId})`), eq(customerLocations.organizationId, ctx.organizationId)),
    )
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.organizationId, ctx.organizationId)))
    .limit(1);

  if (!row) return [];

  const override = positiveOrNull(row.deliveryDistanceKmOverride);
  const distanceKm = override ?? positiveOrNull(row.locationDistanceKm);
  const loadMassKg = positiveOrNull(row.loadMassKg);
  const appliedWetMassKg = row.appliedWetMassTons * KG_PER_TONNE;
  if (distanceKm == null || loadMassKg == null) return [];

  return [
    {
      id: `biochar:${biocharProductId}:application:${applicationId}`,
      kind: "outbound",
      entityType: "biochar",
      entityId: biocharProductId,
      originName: facilityName,
      originLat: facilityGps.lat,
      originLng: facilityGps.lng,
      destinationName: row.locationName,
      destinationLat: row.locationGpsLatitude,
      destinationLng: row.locationGpsLongitude,
      distanceKm,
      distanceSource:
        override != null
          ? (row.deliveryDistanceSource ?? "manual")
          : row.locationDistanceSource,
      isDerived: true,
      loadMassKg,
      appliedWetMassKg,
      materialLabel: null,
      outerHref: null,
      outerCode: null,
    },
  ];
}
