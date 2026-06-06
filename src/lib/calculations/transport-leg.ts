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
  /** User-supplied distance (km); overrides the stored default when valid. */
  distanceKmOverride?: number | null;
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
  // Transport — road, distance-based only
  transportMethodType: "road";
  calculationMethodType: "distance_based";
  vehicleType: string | null;
  modelYear: number | null;
  loadMassKg: number | null;
  /** Inputs missing for a complete, persistable leg. */
  missing: string[];
}

function positiveOrNull(value: number | null | undefined): number | null {
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
    transportMethodType: "road",
    calculationMethodType: "distance_based",
    vehicleType: vehicle?.vehicleType ?? null,
    modelYear: vehicle?.modelYear ?? null,
    loadMassKg: loadMass,
    missing,
  };
}

/** True when the derivation has the hard requirements to persist a leg. */
export function isDerivedLegPersistable(leg: DerivedTransportLeg): boolean {
  return leg.distanceKm != null && leg.loadMassKg != null;
}
