/**
 * The six energy sources the energy page estimates (ADR 0031).
 *
 * Activity is what the operator recorded, in its own unit. The four
 * production sources are columns on the production run; the two transport
 * sources come from feedstock transport legs and biochar deliveries. Display
 * order is production first, then transport.
 */

export type EnergySourceKey =
  | "startup"
  | "genset"
  | "preprocessing"
  | "grid"
  | "feedstockTransport"
  | "biocharTransport";

export type EnergyStage = "production" | "transport";

/** The unit the operator records the activity in. */
export type EnergyActivityUnit = "L" | "kWh" | "t·km";

export interface EnergySourceMeta {
  key: EnergySourceKey;
  label: string;
  unit: EnergyActivityUnit;
  stage: EnergyStage;
}

export const ENERGY_SOURCES: readonly EnergySourceMeta[] = [
  { key: "startup", label: "Startup diesel", unit: "L", stage: "production" },
  { key: "genset", label: "Genset diesel", unit: "L", stage: "production" },
  { key: "preprocessing", label: "Preprocessing fuel", unit: "L", stage: "production" },
  { key: "grid", label: "Grid electricity", unit: "kWh", stage: "production" },
  { key: "feedstockTransport", label: "Feedstock transport", unit: "t·km", stage: "transport" },
  { key: "biocharTransport", label: "Biochar delivery", unit: "t·km", stage: "transport" },
];

export const ENERGY_SOURCE_KEYS: readonly EnergySourceKey[] = ENERGY_SOURCES.map(
  (source) => source.key,
);

export const ENERGY_SOURCE_BY_KEY = Object.fromEntries(
  ENERGY_SOURCES.map((source) => [source.key, source]),
) as Record<EnergySourceKey, EnergySourceMeta>;

/** The sources recorded on a production run itself. */
export const RUN_SOURCE_KEYS = [
  "startup",
  "genset",
  "preprocessing",
  "grid",
] as const satisfies readonly EnergySourceKey[];
export type RunSourceKey = (typeof RUN_SOURCE_KEYS)[number];

/** Diesel sources, all in litres: the ranking used when no factors are set. */
export const DIESEL_SOURCE_KEYS = [
  "startup",
  "genset",
  "preprocessing",
] as const satisfies readonly EnergySourceKey[];

/** Everything a production run's footprint can carry. */
export const PRODUCTION_FOOTPRINT_KEYS: readonly EnergySourceKey[] = [
  ...RUN_SOURCE_KEYS,
  "feedstockTransport",
];

export const ENERGY_STAGES: readonly { key: EnergyStage; label: string }[] = [
  { key: "production", label: "Production energy" },
  { key: "transport", label: "Transport" },
];

/** One number per source. */
export type SourceAmounts = Record<EnergySourceKey, number>;

export function zeroSourceAmounts(): SourceAmounts {
  return {
    startup: 0,
    genset: 0,
    preprocessing: 0,
    grid: 0,
    feedstockTransport: 0,
    biocharTransport: 0,
  };
}

export function sumSourceAmounts(
  amounts: SourceAmounts,
  keys: readonly EnergySourceKey[] = ENERGY_SOURCE_KEYS,
): number {
  return keys.reduce((total, key) => total + amounts[key], 0);
}
