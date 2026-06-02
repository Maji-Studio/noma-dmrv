/**
 * Deterministic text encoding of Isometric's `MeasurementProperty` object
 * (`{ quantity_kind, qualifier }`) for use as a DB key.
 *
 * The wire shape is a two-field object; we encode it as a single text
 * column so the `(reactorId, measurementProperty)` unique constraint on
 * `certifier_sensors` correctly dedups the common case where
 * `qualifier` is null (Postgres unique permits multiple NULLs in
 * nullable columns, so a `(kind, qualifier)` shape would silently
 * allow duplicate temperature/pressure rows per reactor).
 *
 * The pipe is a deliberate non-identifier separator — `quantity_kind`
 * and `qualifier` enums use `[a-z0-9_]` only, so the encoding round-
 * trips without escaping.
 */

import type { components } from "../generated/certify";

export type IsometricMeasurementProperty =
  components["schemas"]["MeasurementProperty"];

const SEPARATOR = "|";

export function encodeMeasurementProperty(
  prop: IsometricMeasurementProperty,
): string {
  return prop.qualifier
    ? `${prop.quantity_kind}${SEPARATOR}${prop.qualifier}`
    : prop.quantity_kind;
}

export function decodeMeasurementProperty(
  encoded: string,
): IsometricMeasurementProperty {
  const sep = encoded.indexOf(SEPARATOR);
  if (sep === -1) {
    return {
      quantity_kind: encoded as IsometricMeasurementProperty["quantity_kind"],
      qualifier: null,
    };
  }
  return {
    quantity_kind: encoded.slice(0, sep) as IsometricMeasurementProperty[
      "quantity_kind"
    ],
    qualifier: encoded.slice(
      sep + 1,
    ) as IsometricMeasurementProperty["qualifier"],
  };
}
