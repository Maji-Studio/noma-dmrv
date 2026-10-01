/**
 * The journey a list of transport legs describes, as the route rail draws it:
 * which legs start a new stop, what each leg counts once its round trip is
 * added, and where the load reads. Pure, so the rail stays presentational.
 */
import { countedRoundTripKm } from "@/lib/calculations/round-trip";
import { DISTANCE_SOURCE_LABELS, type DistanceSourceValue } from "@/schemas/distance-source";
import type { TransportMethodValue } from "@/schemas/transport-legs";
import type { RoutePoint } from "./route-line";

export interface JourneyLegInput {
  originName?: string | null;
  destinationName?: string | null;
  originGpsLatitude?: number | null;
  originGpsLongitude?: number | null;
  destinationGpsLatitude?: number | null;
  destinationGpsLongitude?: number | null;
  distanceKm: number | null | undefined;
  distanceSource?: DistanceSourceValue | null;
  transportMethodType: string;
  loadMassKg: number | null | undefined;
}

export interface JourneyLeg {
  /** Position in the caller's leg list; edit and delete key on it. */
  index: number;
  /** Trimmed stop names; null when the leg does not record one. */
  originName: string | null;
  destinationName: string | null;
  originPoint: RoutePoint | null;
  destinationPoint: RoutePoint | null;
  method: string;
  oneWayKm: number | null;
  /** The one-way distance with its round trip, as emissions count it. */
  countedKm: number | null;
  sourceLabel: string | null;
  loadKg: number | null;
  /**
   * The leg departs somewhere other than where the previous leg arrived, so
   * the rail draws its origin as its own stop instead of merging the two.
   */
  startsNewStop: boolean;
}

export interface Journey {
  legs: JourneyLeg[];
  /** Sum of the counted distances the legs record; null when none do. */
  totalCountedKm: number | null;
  /** Legs without a distance, so a total is never read as complete. */
  missingDistances: number;
  /** Each leg names its own load: one leg, or legs whose loads differ. */
  loadOnLegs: boolean;
  /** Several legs moving the same cargo: the load reads once, under the total. */
  sharedLoadKg: number | null;
}

const METHOD_LABELS: Record<TransportMethodValue, string> = {
  road: "Road",
  rail: "Rail",
  ship: "Ship",
  pipeline: "Pipeline",
  aircraft: "Air",
};

/** "Road", "Rail"…; an unknown stored method reads as itself. */
export function transportMethodLabel(method: string): string {
  return METHOD_LABELS[method as TransportMethodValue] ?? method.replace(/_/g, " ");
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function pointOrNull(
  lat: number | null | undefined,
  lng: number | null | undefined,
): RoutePoint | null {
  return lat != null && lng != null ? { lat, lng } : null;
}

/**
 * A named stop is identified by its name, an unnamed one by its coordinates,
 * and a stop with neither is never identified: two blank stops are not
 * evidence of one place, so they stay two stops.
 */
function stopIdentity(name: string | null, point: RoutePoint | null): string | null {
  if (name) return name.toLowerCase();
  if (point) return `${point.lat},${point.lng}`;
  return null;
}

export function buildJourney(
  inputs: readonly JourneyLegInput[],
  options: { hideLoad?: boolean } = {},
): Journey {
  let previousDestination: string | null = null;
  const legs = inputs.map((input, index): JourneyLeg => {
    const originName = input.originName?.trim() || null;
    const destinationName = input.destinationName?.trim() || null;
    const originPoint = pointOrNull(input.originGpsLatitude, input.originGpsLongitude);
    const destinationPoint = pointOrNull(input.destinationGpsLatitude, input.destinationGpsLongitude);
    const originIdentity = stopIdentity(originName, originPoint);
    const startsNewStop =
      index === 0 || originIdentity === null || originIdentity !== previousDestination;
    previousDestination = stopIdentity(destinationName, destinationPoint);

    const oneWayKm = finiteOrNull(input.distanceKm);
    return {
      index,
      originName,
      destinationName,
      originPoint,
      destinationPoint,
      method: input.transportMethodType,
      oneWayKm,
      countedKm: oneWayKm == null ? null : countedRoundTripKm(oneWayKm),
      sourceLabel: input.distanceSource ? DISTANCE_SOURCE_LABELS[input.distanceSource] : null,
      loadKg: options.hideLoad ? null : finiteOrNull(input.loadMassKg),
      startsNewStop,
    };
  });

  const counted = legs
    .map((leg) => leg.countedKm)
    .filter((km): km is number => km != null);
  const loads = legs.map((leg) => leg.loadKg).filter((kg): kg is number => kg != null);
  // A leg without a load is not the same cargo as one with it.
  const loadsVary =
    loads.some((kg) => kg !== loads[0]) || (loads.length > 0 && loads.length < legs.length);
  const showLoad = !options.hideLoad && loads.length > 0;
  const loadOnLegs = showLoad && (legs.length === 1 || loadsVary);

  return {
    legs,
    totalCountedKm: counted.length > 0 ? counted.reduce((sum, km) => sum + km, 0) : null,
    missingDistances: legs.length - counted.length,
    loadOnLegs,
    sharedLoadKg: showLoad && !loadOnLegs ? loads[0] : null,
  };
}
