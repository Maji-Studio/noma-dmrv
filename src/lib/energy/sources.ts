/**
 * The six energy sources the energy page reports (ADR 0031).
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

/** The unit the operator records the activity in. */
export type EnergyActivityUnit = "L" | "kWh" | "t·km";

export interface EnergySourceMeta {
  key: EnergySourceKey;
  label: string;
  unit: EnergyActivityUnit;
}

export const ENERGY_SOURCES: readonly EnergySourceMeta[] = [
  { key: "startup", label: "Startup diesel", unit: "L" },
  { key: "genset", label: "Genset diesel", unit: "L" },
  { key: "preprocessing", label: "Preprocessing fuel", unit: "L" },
  { key: "grid", label: "Grid electricity", unit: "kWh" },
  { key: "feedstockTransport", label: "Feedstock transport", unit: "t·km" },
  { key: "biocharTransport", label: "Biochar delivery", unit: "t·km" },
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
