/**
 * Transport trip type — whether a road transport leg is recorded as a full
 * round trip (the vehicle returns to origin unloaded / next destination
 * unknown) or a one-way trip with an evidenced onward destination.
 *
 * **Evidence metadata only.** Noma submits the entered leg distance once,
 * whatever the trip type: the Isometric transport component applies its own
 * round-trip treatment on the registry side, so applying a local ×2 as well
 * double-counted the empty return. Decided 2026-08-14; supersedes the
 * interpretation-(a) ruling on issue #316 (2026-07-09), which had noma apply
 * the multiplier at the mass-distance aggregation seam.
 *
 * `return` stays the default for new and legacy records, so the recorded
 * journey remains the conservative one. Orthogonal to `distanceSource`
 * (provenance) and a leg's `isDerived` flag: the stored `distanceKm` is the
 * single entered per-leg value.
 *
 * Values mirror the `transport_trip_type` pgEnum in `@/db/schema/common`.
 */

import { z } from "zod";

export const tripTypes = ["return", "one_way"] as const;

export type TripTypeValue = (typeof tripTypes)[number];

/** Conservative default (round trip) for new and legacy legs. */
export const DEFAULT_TRIP_TYPE: TripTypeValue = "return";

export const TRIP_TYPE_LABELS: Record<TripTypeValue, string> = {
  return: "Return (round trip)",
  one_way: "One-way",
};

export const TRIP_TYPE_OPTIONS: readonly { value: TripTypeValue; label: string }[] =
  tripTypes.map((value) => ({ value, label: TRIP_TYPE_LABELS[value] }));

/** Form/action field: nullable + optional, coalesced to the default at write. */
export const optionalTripType = z.enum(tripTypes).nullable().optional();
