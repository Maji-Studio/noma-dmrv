/**
 * Distance provenance ("distanceSource") — audit metadata qualifying every
 * persisted distance a user can type manually or fill via CALC
 * (map-integration plan, decision 2). Values mirror the `distance_source`
 * pgEnum in `@/db/schema/common` (kept literal there so the client bundle
 * never imports drizzle for runtime values).
 *
 * General invariant: a null distance has a null source; a present distance
 * written without explicit provenance was typed by the operator → `manual`.
 * Delivery trips have one explicit exception: documentary provenance may be
 * stored against the delivery while its distance override remains null, so the
 * trip can evidence the inherited customer-location distance without mutating
 * that shared location. See `resolveDeliveryDistanceSource`.
 * Orthogonal to a transport leg's `isDerived` flag, route geometry, and the
 * transport calculation method.
 */

import { z } from "zod";

export const distanceSources = ["map_estimate", "manual", "document"] as const;

export type DistanceSourceValue = (typeof distanceSources)[number];

/** Form/action field: the provenance of the sibling distance field. */
export const optionalDistanceSource = z
  .enum(distanceSources)
  .nullable()
  .optional();

export const DISTANCE_SOURCE_LABELS: Record<DistanceSourceValue, string> = {
  map_estimate: "Map estimate",
  manual: "Manual",
  document: "Document",
};

/**
 * Normalize a (distance, source) pair at the write boundary:
 * - distance untouched (undefined) → pass the source through unchanged
 * - distance cleared (null) → source null
 * - distance present without explicit source → it was operator-typed → manual
 */
export function resolveDistanceSource(
  distanceKm: number | null | undefined,
  source: DistanceSourceValue | null | undefined,
): DistanceSourceValue | null | undefined {
  if (distanceKm === undefined) return source;
  if (distanceKm === null) return null;
  return source ?? "manual";
}
