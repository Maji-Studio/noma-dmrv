/**
 * Every road transport leg is counted as a round trip.
 *
 * Isometric Transportation Emissions Accounting Module v1.1, §5 "Measurements"
 * (Distance-Based Method): the reporter must use the full round-trip distance
 * when the vehicle returns to its origin unloaded or the next destination is
 * unknown. The registry applies no doubling of its own. Our trucks return
 * empty, so every leg counts twice its one-way distance (issue #852; the
 * evidenced onward-journey exception is out of scope until a real case shows
 * up).
 *
 * The stored `distanceKm` stays the ONE-WAY road distance per leg, which is
 * what operators enter and what supplier and customer sites record. The factor
 * is applied only where a distance is counted (the mass-distance aggregation
 * seam and the evidence ledger) and shown next to the one-way distance.
 */

/** Multiplier on a leg's one-way distance: the vehicle returns empty. */
export const ROUND_TRIP_DISTANCE_FACTOR = 2;

/** The distance a leg contributes to mass·distance: one way × round trip. */
export function countedRoundTripKm(oneWayKm: number): number {
  return oneWayKm * ROUND_TRIP_DISTANCE_FACTOR;
}
