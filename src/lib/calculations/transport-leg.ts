/**
 * Derive a transport leg from records we already hold.
 *
 * Used for feedstock (supplier → facility). Inputs are known, so the user never
 * re-enters route, mass, or vehicle — the only editable value is the distance,
 * which autofills from a stored "distance to facility" on the supplier entity
 * (no GPS auto-calc).
 *
 * Method is always distance-based (Isometric Transportation v1.1 Eq. 3):
 *   emissions = distance (km) × cargo mass (tonnes) × EF (kg CO₂e/tonne·km)
 * We store distance + cargo mass only. The EF lives in the Isometric component
 * blueprint and Certify applies it — we never store or submit a factor.
 */

import type { DistanceSourceValue } from "@/schemas/distance-source";
import { DEFAULT_TRIP_TYPE, type TripTypeValue } from "@/schemas/trip-type";

/** Destination label used when a product's deliveries span multiple sites. */
const CUSTOMER_SITES_LABEL = "Customer sites";

// Weakest-source ranking for aggregated legs: a missing source (pre-provenance
// row) is weaker than manual, manual weaker than a routed estimate, document
// evidence strongest. The aggregate can never claim more than its weakest input.
const DISTANCE_SOURCE_BY_RANK = [null, "manual", "map_estimate", "document"] as const;

function distanceSourceRank(source: DistanceSourceValue | null | undefined): number {
  const rank = DISTANCE_SOURCE_BY_RANK.indexOf(source ?? null);
  return rank === -1 ? 0 : rank;
}

export interface TransportPartyRef {
  name?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
}

export interface DeriveTransportLegInput {
  /** Origin partner (feedstock: supplier). */
  origin: TransportPartyRef | null;
  /** Destination partner (feedstock: facility). */
  destination: TransportPartyRef | null;
  /** Vehicle supplies the vehicle type (maps to the Isometric component EF). */
  vehicle: { vehicleType?: string | null; modelYear?: number | null } | null;
  /** Cargo mass moved on the leg (Eq. 3, W_j), kg. */
  loadMassKg?: number | null;
  /** Stored default distance (km) from the partner entity. */
  storedDistanceKm?: number | null;
  /** Provenance of the stored distance (null on pre-provenance rows). */
  storedDistanceSource?: DistanceSourceValue | null;
  /** User-supplied distance (km); overrides the stored default when valid. */
  distanceKmOverride?: number | null;
  /** Provenance of the override; an override without one was hand-typed. */
  distanceSourceOverride?: DistanceSourceValue | null;
  /**
   * Round-trip vs one-way accounting (issue #316). Omitted / null defaults to
   * `return` — the conservative protocol default. The stored distance stays
   * one-way; the ×2 is applied downstream at mass-distance aggregation.
   */
  tripType?: TripTypeValue | null;
}

export interface DerivedTransportLeg {
  // Route
  originName: string | null;
  originGpsLatitude: number | null;
  originGpsLongitude: number | null;
  destinationName: string | null;
  destinationGpsLatitude: number | null;
  destinationGpsLongitude: number | null;
  distanceKm: number | null;
  /** Inherited from whichever distance won the priority resolution. */
  distanceSource: DistanceSourceValue | null;
  // Transport — road, distance-based only
  transportMethodType: "road";
  calculationMethodType: "distance_based";
  vehicleType: string | null;
  modelYear: number | null;
  loadMassKg: number | null;
  /** Round-trip vs one-way accounting; drives the ×2 at aggregation (#316). */
  tripType: TripTypeValue;
  /** Inputs missing for a complete, persistable leg. */
  missing: string[];
}

export function positiveOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Pure derivation. Returns a partial result with `missing` listing what blocks
 * a persistable leg (distance + load mass are the hard requirements), so the
 * caller can decide whether to upsert a leg or skip it.
 */
export function deriveTransportLeg(
  input: DeriveTransportLegInput,
): DerivedTransportLeg {
  const { origin, destination, vehicle, loadMassKg } = input;

  const override = positiveOrNull(input.distanceKmOverride);
  const stored = positiveOrNull(input.storedDistanceKm);
  const distanceKm = override ?? stored;

  // The leg inherits the WINNING distance's provenance. An override without an
  // explicit source was hand-typed (manual); a stored distance keeps its
  // recorded source, including null for pre-provenance rows (never fabricated).
  const distanceSource: DistanceSourceValue | null =
    override != null
      ? (input.distanceSourceOverride ?? "manual")
      : stored != null
        ? (input.storedDistanceSource ?? null)
        : null;

  const loadMass = positiveOrNull(loadMassKg);

  const missing: string[] = [];
  if (distanceKm == null) missing.push("distance");
  if (loadMass == null) missing.push("load mass");

  return {
    originName: origin?.name ?? null,
    originGpsLatitude: origin?.gpsLatitude ?? null,
    originGpsLongitude: origin?.gpsLongitude ?? null,
    destinationName: destination?.name ?? null,
    destinationGpsLatitude: destination?.gpsLatitude ?? null,
    destinationGpsLongitude: destination?.gpsLongitude ?? null,
    distanceKm,
    distanceSource,
    transportMethodType: "road",
    calculationMethodType: "distance_based",
    vehicleType: vehicle?.vehicleType ?? null,
    modelYear: vehicle?.modelYear ?? null,
    loadMassKg: loadMass,
    tripType: input.tripType ?? DEFAULT_TRIP_TYPE,
    missing,
  };
}

/** True when the derivation has the hard requirements to persist a leg. */
export function isDerivedLegPersistable(leg: DerivedTransportLeg): boolean {
  return leg.distanceKm != null && leg.loadMassKg != null;
}

// ============================================
// Distribution leg aggregation (biochar)
// ============================================

/** One delivery's contribution to a product's aggregated distribution leg. */
export interface DistributionLegRow {
  /** Cargo mass moved on this delivery, kg. */
  loadMassKg: number | null;
  /** Road distance facility → destination, km. */
  distanceKm: number | null;
  /** Provenance of that distance (delivery override's or the location's). */
  distanceSource: DistanceSourceValue | null;
  /** Destination (customer-location) name, when known. */
  locationName: string | null;
  locationGpsLatitude: number | null;
  locationGpsLongitude: number | null;
  /** Round-trip vs one-way accounting for this delivery (issue #316). */
  tripType?: TripTypeValue | null;
}

export interface AggregatedDistributionLeg {
  /** Σ of qualifying deliveries' mass; 0 when none qualify. */
  totalMassKg: number;
  /** Mass-weighted-average distance, or null when nothing qualifies. */
  weightedDistanceKm: number | null;
  /**
   * Weakest contributing source: null if any contributor is unknown, else
   * `manual` if any is manual, else `map_estimate` if any is a map estimate,
   * `document` only when every contributor is document-backed.
   */
  distanceSource: DistanceSourceValue | null;
  /** Single destination's name, "Customer sites" for many, null for none. */
  destinationName: string | null;
  destinationGpsLatitude: number | null;
  destinationGpsLongitude: number | null;
  /**
   * Collapsed trip type for the single aggregated leg. Conservative: `return`
   * if ANY qualifying delivery is a round trip, else `one_way`. Empty → the
   * `return` default (issue #316). One leg can carry only one trip type, so the
   * safer (higher-emission) treatment wins, mirroring how distanceSource takes
   * the weakest contributor.
   */
  tripType: TripTypeValue;
}

/**
 * Collapse a product's deliveries into ONE distribution leg. A product is
 * delivered to many sites at different distances, but the one-derived-per-entity
 * invariant means a single leg. The distance-based method needs `Σ distⱼ × massⱼ`;
 * storing `totalMass` with the mass-weighted-average distance is exact, since
 * `(Σ distⱼ·massⱼ / Σ massⱼ) × Σ massⱼ = Σ distⱼ·massⱼ`. Deliveries missing a
 * positive mass or distance are skipped.
 */
export function aggregateDistributionLegs(
  rows: DistributionLegRow[],
): AggregatedDistributionLeg {
  let totalMassKg = 0;
  let weightedDistanceSum = 0;
  let weakestSourceRank = Infinity;
  // Conservative collapse: any qualifying round-trip delivery makes the whole
  // aggregated leg a round trip (a null/unset tripType counts as `return`).
  let anyReturn = false;
  const names = new Set<string>();
  // GPS observed per destination name: a coordinate pair, or `null` once two
  // rows report *differing* coords for the same name. We can't honestly report
  // one GPS for inconsistent data, so a conflict collapses to `null` rather
  // than letting last-seen win.
  const gpsByName = new Map<string, { lat: number; lng: number } | null>();

  for (const row of rows) {
    const mass = positiveOrNull(row.loadMassKg);
    const distance = positiveOrNull(row.distanceKm);
    if (mass === null || distance === null) continue;
    totalMassKg += mass;
    weightedDistanceSum += mass * distance;
    weakestSourceRank = Math.min(weakestSourceRank, distanceSourceRank(row.distanceSource));
    if (row.tripType !== "one_way") anyReturn = true;
    if (row.locationName) {
      names.add(row.locationName);
      // Only record GPS when this row actually carries coordinates, so a row
      // missing them neither registers nor clobbers a pair found elsewhere.
      if (row.locationGpsLatitude !== null && row.locationGpsLongitude !== null) {
        const coord = { lat: row.locationGpsLatitude, lng: row.locationGpsLongitude };
        const existing = gpsByName.get(row.locationName);
        if (existing === undefined) {
          gpsByName.set(row.locationName, coord);
        } else if (existing && (existing.lat !== coord.lat || existing.lng !== coord.lng)) {
          // Distinct coords for the same name → ambiguous; drop to null.
          gpsByName.set(row.locationName, null);
        }
      }
    }
  }

  const weightedDistanceKm =
    totalMassKg > 0 ? weightedDistanceSum / totalMassKg : null;
  const distanceSource =
    totalMassKg > 0 ? DISTANCE_SOURCE_BY_RANK[weakestSourceRank] ?? null : null;
  const single = names.size === 1;
  const singleGps = single ? gpsByName.get([...names][0]) ?? null : null;
  return {
    totalMassKg,
    weightedDistanceKm,
    distanceSource,
    destinationName: single
      ? [...names][0]
      : names.size > 1
        ? CUSTOMER_SITES_LABEL
        : null,
    destinationGpsLatitude: singleGps ? singleGps.lat : null,
    destinationGpsLongitude: singleGps ? singleGps.lng : null,
    // No qualifying delivery → `return` default (conservative); nothing is
    // aggregated so the trip type is moot, but stays consistent with the default.
    tripType: anyReturn || totalMassKg === 0 ? "return" : "one_way",
  };
}
