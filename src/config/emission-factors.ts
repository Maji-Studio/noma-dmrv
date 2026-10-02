/**
 * Prefill values for a facility's emission factors (ADR 0031).
 *
 * These seed the settings form only; nothing estimates until an Owner or
 * Admin saves the factors. They mirror the sandbox template defaults in
 * `scripts/isometric-bootstrap-constants.ts` (DEFRA 2024: diesel 2.68 kg CO2e
 * per litre, articulated HGV 107 g CO2e per tonne-km). Grid electricity has
 * no default because it is country-specific.
 */
export const DEFAULT_DIESEL_KG_CO2E_PER_LITRE = 2.68;
export const DEFAULT_ROAD_FREIGHT_KG_CO2E_PER_TONNE_KM = 0.107;

/** Largest factor the numeric(12,6) column holds, rounded down. */
export const EMISSION_FACTOR_INPUT_MAX = 999_999;

export const EMISSION_FACTOR_SOURCE_NOTE_MAX_LENGTH = 500;
