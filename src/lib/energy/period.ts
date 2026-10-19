/**
 * Period presets for the energy page. Every day is a facility-local
 * `YYYY-MM-DD` string, so the arithmetic stays on calendar days and never
 * crosses a timezone.
 */
import { addDaysIso } from "@/lib/date-utils";
import type { EnergyCreditBatchInput, EnergyPeriod } from "./types";

export type EnergyPeriodPreset = "30d" | "90d" | "12m" | "ytd" | "all";

export const ENERGY_PERIOD_PRESETS: readonly {
  key: EnergyPeriodPreset;
  label: string;
}[] = [
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "12m", label: "Last 12 months" },
  { key: "ytd", label: "This year" },
  { key: "all", label: "All time" },
];

export const DEFAULT_ENERGY_PERIOD_PRESET: EnergyPeriodPreset = "12m";

const DAYS_30 = 30;
const DAYS_90 = 90;
const MONTHS_12 = 12;
const MONTHS_PER_YEAR = 12;

export function isEnergyPeriodPreset(value: string): value is EnergyPeriodPreset {
  return ENERGY_PERIOD_PRESETS.some((preset) => preset.key === value);
}

/** First day of the month `monthsBack` months before `day`'s month. */
function monthStartBefore(day: string, monthsBack: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1;
  const absolute = year * MONTHS_PER_YEAR + month - monthsBack;
  const startYear = Math.floor(absolute / MONTHS_PER_YEAR);
  const startMonth = (absolute % MONTHS_PER_YEAR) + 1;
  return `${String(startYear).padStart(4, "0")}-${String(startMonth).padStart(2, "0")}-01`;
}

/**
 * The period a preset covers, ending on `today`. Last 12 months starts on the
 * first of the month eleven months back, so the current month counts as one.
 */
export function energyPresetPeriod(
  preset: EnergyPeriodPreset,
  today: string,
): EnergyPeriod {
  switch (preset) {
    case "30d":
      return { from: addDaysIso(today, 1 - DAYS_30), to: today };
    case "90d":
      return { from: addDaysIso(today, 1 - DAYS_90), to: today };
    case "12m":
      return { from: monthStartBefore(today, MONTHS_12 - 1), to: today };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return { from: null, to: today };
  }
}

export function dayInPeriod(day: string, period: EnergyPeriod): boolean {
  return (period.from == null || day >= period.from) && day <= period.to;
}

/** A credit batch counts in a period when its dates overlap it. */
export function creditBatchInPeriod(
  batch: Pick<EnergyCreditBatchInput, "startDate" | "endDate">,
  period: EnergyPeriod,
): boolean {
  return (
    (period.from == null || batch.endDate >= period.from) &&
    batch.startDate <= period.to
  );
}
