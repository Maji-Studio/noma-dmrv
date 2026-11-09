import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { canonicalDecimal, canonicalUnit } from "./units";

/** The Isometric blueprint of a fixed kgCO2e rate per unit of time times monitored time. */
export const TIME_BASED_BLUEPRINT_KEY = "time_based_emissions";
/** The input key of that fixed rate in a template's enrichment. */
export const TIME_RATE_INPUT_KEY = "emissions_per_unit_time";

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = 3600;
const KG_PER_GRAM = 0.001;

/** Canonical time atoms (see ATOMS in units.ts) in hours. */
export const HOURS_PER_UNIT: Record<string, number> = {
  h: 1,
  day: HOURS_PER_DAY,
  min: 1 / MINUTES_PER_HOUR,
  s: 1 / SECONDS_PER_HOUR,
};
/** Canonical carbon atoms in kilograms CO2e. */
export const KG_PER_CARBON_UNIT: Record<string, number> = { kgCO2e: 1, gCO2e: KG_PER_GRAM, tCO2e: KG_PER_TONNE };

/**
 * A template's fixed rate in kgCO2e per hour, or null when it is missing or its
 * unit is not a carbon amount per time ("kgCO2e / day" becomes a 24th of the number).
 */
export function timeEmissionRatePerHour(unit: string | null | undefined, fixedValue: string | number | null | undefined): number | null {
  if (!unit || fixedValue == null) return null;
  const canonical = canonicalUnit("time_emission_factor", unit);
  const value = canonicalDecimal(fixedValue);
  if (!canonical || value === undefined) return null;
  const [carbon, time] = canonical.split(" / ");
  const kgPerCarbon = Object.hasOwn(KG_PER_CARBON_UNIT, carbon) ? KG_PER_CARBON_UNIT[carbon] : undefined;
  const hoursPerTime = Object.hasOwn(HOURS_PER_UNIT, time) ? HOURS_PER_UNIT[time] : undefined;
  if (kgPerCarbon === undefined || hoursPerTime === undefined) return null;
  return (Number(value) * kgPerCarbon) / hoursPerTime;
}

/** kgCO2e of an entry's monitored time at a rate per hour, or null when either cannot be read. */
export function timeEmissionKg(time: { magnitude: string; unit: string }, ratePerHour: number | null): number | null {
  const canonical = canonicalUnit("time", time.unit);
  const magnitude = canonicalDecimal(time.magnitude);
  if (ratePerHour === null || !canonical || magnitude === undefined || !Object.hasOwn(HOURS_PER_UNIT, canonical)) return null;
  return Number(magnitude) * HOURS_PER_UNIT[canonical] * ratePerHour;
}
