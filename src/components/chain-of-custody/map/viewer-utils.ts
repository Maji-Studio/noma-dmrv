/**
 * Pure helpers for the Carbon Viewer — endpoint resolution, arc geometry,
 * chip anchoring. No MapLibre, no React; unit-testable.
 */

import type {
  ChainGeoLeg,
  ChainGeoNode,
  ChainOfCustodyGeoData,
} from "@/data-access/chain-of-custody-geo";
import type { GeoPoint, RouteGeometry } from "@/lib/geo/types";
import {
  ARC_BOW_FACTOR,
  ARC_MAX_BOW,
  ARC_SEGMENTS,
  CHIP_BASE_FRACTION,
  CHIP_STAGGER_FRACTION,
  CHIP_STAGGER_STEPS,
} from "./viewer-constants";

/** A leg whose two endpoints resolved to coordinates — drawable on the map. */
export interface PlottableLeg {
  leg: ChainGeoLeg;
  origin: GeoPoint;
  destination: GeoPoint;
}

export interface ResolvedLegs {
  plottable: PlottableLeg[];
  /** Legs missing an endpoint — listed, never drawn. */
  unplottable: ChainGeoLeg[];
}

function point(lat: number | null, lng: number | null): GeoPoint | null {
  return lat != null && lng != null ? { lat, lng } : null;
}

/** A node's real position — facility-inherited markers don't anchor legs. */
function ownPosition(node: ChainGeoNode | undefined): GeoPoint | null {
  if (!node || node.positionSource === "facility" || node.positionSource === "none") {
    return null;
  }
  return point(node.lat, node.lng);
}

/**
 * Resolve each leg's drawable endpoints. A leg's own stored endpoint wins;
 * otherwise inbound legs fall back to the feedstock's position → facility,
 * and outbound legs to facility → the application's position.
 */
export function resolveLegEndpoints(geo: ChainOfCustodyGeoData): ResolvedLegs {
  const facility = point(geo.facility.lat, geo.facility.lng);
  const nodesByEntityId = new Map(geo.nodes.map((node) => [node.entityId, node]));
  const application = geo.nodes.find((node) => node.kind === "application");

  const plottable: PlottableLeg[] = [];
  const unplottable: ChainGeoLeg[] = [];

  for (const leg of geo.legs) {
    let origin = point(leg.originLat, leg.originLng);
    let destination = point(leg.destinationLat, leg.destinationLng);

    if (leg.kind === "inbound") {
      origin = origin ?? ownPosition(nodesByEntityId.get(leg.entityId));
      destination = destination ?? facility;
    } else {
      origin = origin ?? facility;
      destination = destination ?? ownPosition(application);
    }

    if (origin && destination) {
      plottable.push({ leg, origin, destination });
    } else {
      unplottable.push(leg);
    }
  }

  return { plottable, unplottable };
}

/**
 * Gently bowed quadratic-bezier arc between two points (concept build) —
 * the fallback when no road geometry resolved. [lng, lat] pairs.
 */
export function bowedArc(a: GeoPoint, b: GeoPoint): [number, number][] {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const length = Math.hypot(dx, dy) || 1;
  const bow = Math.min(ARC_MAX_BOW, length * ARC_BOW_FACTOR);
  const controlLng = (a.lng + b.lng) / 2 - (dy / length) * bow;
  const controlLat = (a.lat + b.lat) / 2 + (dx / length) * bow;

  const coordinates: [number, number][] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const t = i / ARC_SEGMENTS;
    const u = 1 - t;
    coordinates.push([
      u * u * a.lng + 2 * u * t * controlLng + t * t * b.lng,
      u * u * a.lat + 2 * u * t * controlLat + t * t * b.lat,
    ]);
  }
  return coordinates;
}

/** Line coordinates for a leg: real road geometry when resolved, else arc. */
export function legLineCoordinates(
  plottable: PlottableLeg,
  geometry: RouteGeometry | null | undefined
): { coordinates: [number, number][]; routed: boolean } {
  if (geometry && geometry.coordinates.length >= 2) {
    return { coordinates: geometry.coordinates, routed: true };
  }
  return { coordinates: bowedArc(plottable.origin, plottable.destination), routed: false };
}

/**
 * Distance-chip anchor: a point part-way along the polyline, staggered by
 * leg index so chips on neighbouring arcs don't collide. Throws on an empty
 * polyline — callers always pass `legLineCoordinates` output (≥ 2 points).
 */
export function chipAnchor(
  coordinates: [number, number][],
  legIndex: number
): [number, number] {
  if (coordinates.length === 0) {
    throw new Error("chipAnchor requires a non-empty coordinates array");
  }
  const fraction =
    CHIP_BASE_FRACTION + (legIndex % CHIP_STAGGER_STEPS) * CHIP_STAGGER_FRACTION;
  const index = Math.min(
    coordinates.length - 1,
    Math.max(0, Math.round(fraction * (coordinates.length - 1)))
  );
  return coordinates[index];
}

/** Total stored distance across legs (the rail header figure), km. */
export function totalLegDistanceKm(legs: ChainGeoLeg[]): number {
  return Math.round(legs.reduce((sum, leg) => sum + leg.distanceKm, 0) * 10) / 10;
}
