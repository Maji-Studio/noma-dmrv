import type { DistanceSourceValue } from "@/schemas/distance-source";

/**
 * The provenance a transport leg's distance edit should write, or `undefined`
 * to leave it unchanged. A map estimate always claims `map_estimate`; a hand
 * edit only degrades a map estimate to `manual`, so an explicit manual or
 * legacy document value survives.
 */
export function nextTransportDistanceSource(
  reported: DistanceSourceValue | null,
  current: DistanceSourceValue | null | undefined,
): DistanceSourceValue | undefined {
  if (reported === "map_estimate") return "map_estimate";
  if (current === "map_estimate") return reported ?? "manual";
  return undefined;
}
