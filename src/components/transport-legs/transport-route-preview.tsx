"use client";

import type { DistanceSourceValue } from "@/schemas/distance-source";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import { positiveOrNull } from "@/lib/calculations/transport-leg";
import type { JourneyLegInput } from "./transport-journey-model";
import {
  deriveTransportLegCertStatuses,
  summarizeTransportLegCertStatuses,
} from "./transport-leg-cert-status";
import { TransportRoute } from "./transport-route";

/** An end as the caller holds it: either coordinate may be missing. */
interface RoutePointInput {
  lat: number | null | undefined;
  lng: number | null | undefined;
}

interface TransportRoutePreviewProps {
  /** Route category; names the route and the CERT requirements. */
  entityType: TransportEntityTypeValue;
  originName: string | null | undefined;
  destinationName: string | null | undefined;
  /** Coordinates of each end; with both, the route offers its map. */
  originPoint?: RoutePointInput;
  destinationPoint?: RoutePointInput;
  /** One-way distance; the rail adds the round trip it counts. */
  distanceKm: number | null | undefined;
  distanceSource: DistanceSourceValue | null | undefined;
  loadMassKg: number | null | undefined;
  /** The values are saved, so the CERT chip may resolve. Leave false for a form draft. */
  saved?: boolean;
  /** Evidence state; left out, the leg draws no evidence icon. */
  evidenceAttached?: boolean;
  /** Shown while there is no distance, load or pair of coordinates to draw. */
  emptyMessage: string;
  /** Override the route's accessible name. */
  title?: string;
  /** A route before goods move (an order) has no load and no CERT chip. */
  plannedRoute?: boolean;
  /**
   * Show the route's CERT chip. Read views do; forms leave it off because
   * their distance and mass inputs carry their own chips.
   */
  certTag?: boolean;
}

/**
 * The one road leg a record moves goods along, drawn from values the caller
 * already holds instead of the saved transport-leg rows. A delivery or a
 * feedstock form being edited shows the same route the saved leg will. With
 * both ends located, the route draws (and offers its map) even before a
 * distance is recorded, so the missing distance reads on the leg.
 */
export function TransportRoutePreview({
  entityType,
  originName,
  destinationName,
  originPoint,
  destinationPoint,
  distanceKm,
  distanceSource,
  loadMassKg,
  saved = false,
  evidenceAttached,
  emptyMessage,
  title,
  plannedRoute = false,
  certTag = false,
}: TransportRoutePreviewProps) {
  const distance = positiveOrNull(distanceKm);
  const load = plannedRoute ? null : positiveOrNull(loadMassKg);
  const located =
    originPoint?.lat != null && originPoint.lng != null &&
    destinationPoint?.lat != null && destinationPoint.lng != null;
  const legs: JourneyLegInput[] = distance == null && load == null && !located
    ? []
    : [{
        originName,
        destinationName,
        originGpsLatitude: originPoint?.lat,
        originGpsLongitude: originPoint?.lng,
        destinationGpsLatitude: destinationPoint?.lat,
        destinationGpsLongitude: destinationPoint?.lng,
        distanceKm: distance,
        distanceSource: distance == null ? null : (distanceSource ?? null),
        transportMethodType: "road",
        loadMassKg: load,
      }];

  const cert = certTag && !plannedRoute
    ? summarizeTransportLegCertStatuses(deriveTransportLegCertStatuses(legs, saved, entityType))
    : undefined;

  return (
    <TransportRoute
      entityType={entityType}
      legs={legs}
      title={title}
      cert={cert}
      hideLoad={plannedRoute}
      emptyMessage={emptyMessage}
      evidence={() => evidenceAttached}
    />
  );
}
