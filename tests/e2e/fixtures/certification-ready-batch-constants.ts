// Fixed inputs for `seedUngroupedReadyBatchWithChain` (certification-helpers.ts).

export const READY_BIOCHAR_OUTPUT_KG = 150;
export const READY_BIOCHAR_DRY_MASS_KG = 147; // ≤ output (DB check constraint)
export const READY_FEEDSTOCK_WET_MASS_KG = 420;
export const READY_FEEDSTOCK_DRY_MASS_KG = 400;
export const READY_FEEDSTOCK_MOISTURE_PCT = 4.76;
export const READY_BIOCHAR_MOISTURE_PCT = 2;
export const READY_DIESEL_OPERATION_L = 0;
export const READY_PREPROCESSING_FUEL_L = 0;
export const READY_DIESEL_GENSET_L = 0;
export const READY_ELECTRICITY_KWH = 0;
export const SAMPLE_TOTAL_CARBON_PCT = 80;
export const SAMPLE_ORGANIC_CARBON_PCT = 78;
export const SAMPLE_INORGANIC_CARBON_PCT = 2;
export const SAMPLE_H_TO_CORG_RATIO = 0.4;
export const SAMPLE_O_TO_CORG_RATIO = 0.1;
// 1000-year lab evidence (certify-field-registry sample descriptors +
// computeBlueprint1000YearDurability completeness): measured inorganic carbon,
// sReflectanceFraction, and randomReflectanceR0Percent must be entered, plus
// reactive OR residual carbon.
export const SAMPLE_S_REFLECTANCE_FRACTION = 0.9;
export const SAMPLE_RANDOM_REFLECTANCE_R0_PCT = 2.85;
export const SAMPLE_REACTIVE_CARBON_PCT = 32.6;
export const SAMPLE_RESIDUAL_CARBON_PCT = 67.4;
export const READY_SAMPLE_REPLICATE_COUNT = 3;
export const READY_REFERENCE_SOIL_TEMPERATURE_C = 25;
export const READY_REFERENCE_SOIL_TEMPERATURE_SOURCE =
  "E2E readiness fixture reference";
export const TRANSPORT_LEG_DISTANCE_KM = 50;
export const TRANSPORT_LEG_LOAD_MASS_KG = 100;
export const TRANSPORT_LEG_EMISSION_FACTOR = 0.1;
export const READY_TRANSPORT_EVIDENCE_URL =
  "https://example.invalid/e2e-transport-evidence.pdf";
export const READY_PRODUCTION_READINGS_URL =
  "https://example.invalid/e2e-production-readings.csv";
export const READY_APPLICATION_EVIDENCE_URL = "https://example.com/e2e-geotagged-application.jpg";
export const READY_APPLICATION_EVIDENCE_ROLES = [
  "stockpile",
  "spreading",
  "incorporation",
] as const;
export const E2E_ISOMETRIC_FEEDSTOCK_TYPE_ID_PREFIX = "e2e-fst-";
