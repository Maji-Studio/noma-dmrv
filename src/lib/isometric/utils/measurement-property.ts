/**
 * Deterministic text encoding of Isometric's `MeasurementProperty` object
 * (`{ quantity_kind, qualifier }`) for stable identity comparisons.
 *
 * The pipe is a deliberate non-identifier separator — `quantity_kind`
 * and `qualifier` enums use `[a-z0-9_]` only, so property identities do not
 * need escaping.
 */

import type { components } from "../generated/certify";

export type IsometricMeasurementProperty =
  components["schemas"]["MeasurementProperty"];

const SEPARATOR = "|";

export function encodeMeasurementProperty(
  prop: IsometricMeasurementProperty,
): string {
  return prop.qualifier !== null
    ? `${prop.quantity_kind}${SEPARATOR}${prop.qualifier}`
    : prop.quantity_kind;
}
