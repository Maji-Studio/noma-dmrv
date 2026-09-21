/** Unit submitted for kilogram-valued Isometric quantities. */
export const ISOMETRIC_KILOGRAM_UNIT = "kg";

// Verified from live Certify Production Batch (2026-08-10) and Biochar
// Application (2026-08-27) responses: Isometric canonicalizes submitted `kg`
// units to `kilogram`.
const KILOGRAM_UNIT_ALIASES = new Set([
  ISOMETRIC_KILOGRAM_UNIT,
  "kilogram",
]);

/** Compare request/readback spellings without converting mass units. */
export function kilogramUnitsMatch(actual: string, expected: string): boolean {
  return (
    actual === expected ||
    (KILOGRAM_UNIT_ALIASES.has(actual) &&
      KILOGRAM_UNIT_ALIASES.has(expected))
  );
}
