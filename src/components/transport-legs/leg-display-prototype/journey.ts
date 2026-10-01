/**
 * PROTOTYPE. One normalized journey every `?leg=` variant draws from, so the
 * variants disagree on layout only, never on the figures. Not for merge.
 */
import type { ReactNode } from "react";
import {
  AirplaneIcon,
  BoatIcon,
  PathIcon,
  PipeIcon,
  TrainIcon,
  TruckIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { countedRoundTripKm } from "@/lib/calculations/round-trip";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { DISTANCE_SOURCE_LABELS, type DistanceSourceValue } from "@/schemas/distance-source";
import type { TransportMethodValue } from "@/schemas/transport-legs";

const KG_PER_TONNE = 1000;

export interface PrototypeLegInput {
  originName?: string | null;
  destinationName?: string | null;
  distanceKm?: number | null;
  distanceSource?: DistanceSourceValue | null;
  transportMethodType: string;
  loadMassKg?: number | null;
  originGpsLatitude?: number | null;
  originGpsLongitude?: number | null;
  destinationGpsLatitude?: number | null;
  destinationGpsLongitude?: number | null;
}

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface PrototypeLeg {
  index: number;
  from: string;
  to: string;
  method: string;
  methodLabel: string;
  MethodIcon: Icon;
  oneWayKm: number | null;
  countedKm: number | null;
  /** "Map estimate", "Manual entry"… null when not recorded. */
  sourceLabel: string | null;
  loadKg: number | null;
  /** Load × counted distance, in tonne-km. */
  tonneKm: number | null;
  /** undefined: this surface shows evidence elsewhere. */
  evidenceAttached: boolean | undefined;
  actions?: ReactNode;
  originPoint: MapPoint | null;
  destinationPoint: MapPoint | null;
}

export interface PrototypeJourney {
  legs: PrototypeLeg[];
  /** Origin of the first leg, then every destination. */
  stops: string[];
  totalOneWayKm: number | null;
  totalCountedKm: number | null;
  totalTonneKm: number | null;
  /** Same load on every leg: the cargo, once. Null when loads vary or are missing. */
  sharedLoadKg: number | null;
  loadsVary: boolean;
  /** Legs without a distance, so a total is never read as complete. */
  missingDistances: number;
  /** The surface has no load to show (an order before any delivery). */
  hideLoad: boolean;
}

const METHOD_ICONS: Record<TransportMethodValue, Icon> = {
  road: TruckIcon,
  rail: TrainIcon,
  ship: BoatIcon,
  pipeline: PipeIcon,
  aircraft: AirplaneIcon,
};

const METHOD_LABELS: Record<TransportMethodValue, string> = {
  road: "Road",
  rail: "Rail",
  ship: "Ship",
  pipeline: "Pipeline",
  aircraft: "Air",
};

function point(lat: number | null | undefined, lng: number | null | undefined): MapPoint | null {
  return lat != null && lng != null ? { lat, lng } : null;
}

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function sum(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value != null);
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) : null;
}

export function buildPrototypeJourney(
  inputs: readonly PrototypeLegInput[],
  options: {
    evidence?: (index: number) => boolean | undefined;
    actions?: (index: number) => ReactNode;
    hideLoad?: boolean;
  } = {},
): PrototypeJourney {
  const legs = inputs.map((input, index): PrototypeLeg => {
    const oneWayKm = finite(input.distanceKm);
    const countedKm = oneWayKm == null ? null : countedRoundTripKm(oneWayKm);
    const loadKg = options.hideLoad ? null : finite(input.loadMassKg);
    const method = input.transportMethodType;
    return {
      index,
      from: input.originName?.trim() || MISSING_VALUE.notRecorded,
      to: input.destinationName?.trim() || MISSING_VALUE.notRecorded,
      method,
      methodLabel: METHOD_LABELS[method as TransportMethodValue] ?? method,
      MethodIcon: METHOD_ICONS[method as TransportMethodValue] ?? PathIcon,
      oneWayKm,
      countedKm,
      sourceLabel: input.distanceSource ? DISTANCE_SOURCE_LABELS[input.distanceSource] : null,
      loadKg,
      tonneKm: countedKm != null && loadKg != null ? (loadKg / KG_PER_TONNE) * countedKm : null,
      evidenceAttached: options.evidence?.(index),
      actions: options.actions?.(index),
      originPoint: point(input.originGpsLatitude, input.originGpsLongitude),
      destinationPoint: point(input.destinationGpsLatitude, input.destinationGpsLongitude),
    };
  });

  const stops: string[] = [];
  legs.forEach((leg, index) => {
    if (index === 0 || stops[stops.length - 1] !== leg.from) stops.push(leg.from);
    stops.push(leg.to);
  });

  const loads = legs.map((leg) => leg.loadKg).filter((kg): kg is number => kg != null);
  const loadsVary = loads.length > 1 && loads.some((kg) => kg !== loads[0]);

  return {
    legs,
    stops,
    totalOneWayKm: sum(legs.map((leg) => leg.oneWayKm)),
    totalCountedKm: sum(legs.map((leg) => leg.countedKm)),
    totalTonneKm: sum(legs.map((leg) => leg.tonneKm)),
    sharedLoadKg: !loadsVary && loads.length === legs.length && loads.length > 0 ? loads[0] : null,
    loadsVary,
    missingDistances: legs.filter((leg) => leg.oneWayKm == null).length,
    hideLoad: options.hideLoad ?? false,
  };
}

export function km(value: number | null): string {
  if (value == null) return MISSING_VALUE.notRecorded;
  return `${Math.round(value * 10) / 10} km`;
}

export function tonnes(kg: number | null): string {
  if (kg == null) return MISSING_VALUE.notRecorded;
  return kg >= KG_PER_TONNE ? `${(kg / KG_PER_TONNE).toFixed(1)} t` : `${Math.round(kg).toLocaleString()} kg`;
}

export function tonneKm(value: number | null): string {
  if (value == null) return MISSING_VALUE.notRecorded;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} t·km`;
}
