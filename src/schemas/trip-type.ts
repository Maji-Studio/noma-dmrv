/**
 * Transport trip type — whether a road transport leg is accounted as a full
 * round trip (the vehicle returns to origin unloaded / next destination
 * unknown) or a one-way trip with an evidenced onward destination.
 *
 * Isometric GHG Accounting Module v1.1, "Transportation Emissions"
 * (Distance-Based Method): "When no onwards journey information is available,
 * the full round trip must be assumed in calculations." Resolved as
 * interpretation (a) on issue #316 (2026-07-09): a `return` leg contributes
 * `(one-way distance × 2) × load mass`; a `one_way` leg (evidenced onward
 * destination) contributes `one-way distance × load mass`.
 *
 * `return` is the conservative protocol default for new and legacy records.
 * Orthogonal to `distanceSource` (provenance) and a leg's `isDerived` flag:
 * the stored `distanceKm` stays the ONE-WAY per-leg value; the ×2 is applied at
 * the mass-distance aggregation seam, never baked into the stored distance.
 *
 * Values mirror the `transport_trip_type` pgEnum in `@/db/schema/common`.
 */

import { z } from "zod";

export const tripTypes = ["return", "one_way"] as const;

export type TripTypeValue = (typeof tripTypes)[number];

/** Conservative protocol default (round trip) for new and legacy legs. */
export const DEFAULT_TRIP_TYPE: TripTypeValue = "return";

/** Multiplier on a leg's one-way distance when the vehicle returns empty. */
export const ROUND_TRIP_DISTANCE_FACTOR = 2;
/** Multiplier for an evidenced one-way trip (no empty-return distance). */
export const ONE_WAY_DISTANCE_FACTOR = 1;

/**
 * Round-trip distance factor for a leg's trip type. A missing / null value is
 * treated as `return` — the conservative protocol default — so legacy legs and
 * unmigrated rows never silently under-count.
 */
export function roundTripDistanceFactor(
  tripType: TripTypeValue | null | undefined,
): number {
  return tripType === "one_way"
    ? ONE_WAY_DISTANCE_FACTOR
    : ROUND_TRIP_DISTANCE_FACTOR;
}

export const TRIP_TYPE_LABELS: Record<TripTypeValue, string> = {
  return: "Return (round trip)",
  one_way: "One-way",
};

export const TRIP_TYPE_OPTIONS: readonly { value: TripTypeValue; label: string }[] =
  tripTypes.map((value) => ({ value, label: TRIP_TYPE_LABELS[value] }));

/** Form/action field: nullable + optional, coalesced to the default at write. */
export const optionalTripType = z.enum(tripTypes).nullable().optional();
