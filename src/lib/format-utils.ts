/**
 * Shared formatting utilities for display values
 */

import { format, isValid, parseISO } from "date-fns";
import { parseLocalDateString } from "@/lib/date-utils";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FORMAT = "MMM d, yyyy";
const DATE_TIME_FORMAT = "MMM d, yyyy, HH:mm";
const SAME_YEAR_RANGE_START_FORMAT = "MMM d";
const FALLBACK_DISPLAY = "—";
const KG_PER_TONNE = 1000;
const CO2E_TONNES_MAX_FRACTION_DIGITS = 3;

type DateValue = string | Date | null | undefined;

function parseDateValue(value: DateValue): Date | null {
  if (!value) return null;

  try {
    const date =
      typeof value === "string" && DATE_ONLY_PATTERN.test(value)
        ? parseLocalDateString(value)
        : typeof value === "string"
          ? parseISO(value)
          : value;

    return isValid(date) ? date : null;
  } catch {
    return null;
  }
}

/**
 * Format a calendar date for user-facing display. Bare `YYYY-MM-DD` values are
 * parsed in local time so they cannot drift to the previous day west of UTC.
 * Returns "—" for null, undefined, or invalid values.
 */
export function formatDate(value: DateValue): string {
  const date = parseDateValue(value);
  return date ? format(date, DATE_FORMAT) : FALLBACK_DISPLAY;
}

/**
 * Format a date and time for user-facing display using a 24-hour clock.
 * Returns "—" for null, undefined, or invalid values.
 */
export function formatDateTime(value: DateValue): string {
  const date = parseDateValue(value);
  return date ? format(date, DATE_TIME_FORMAT) : FALLBACK_DISPLAY;
}

/**
 * Format a user-facing date range. Ranges within one calendar year omit the
 * year from the start; cross-year ranges show both years in full.
 * Returns "—" when either boundary is null, undefined, or invalid.
 */
export function formatDateRange(start: DateValue, end: DateValue): string {
  const startDate = parseDateValue(start);
  const endDate = parseDateValue(end);
  if (!startDate || !endDate) return FALLBACK_DISPLAY;

  if (startDate.getFullYear() === endDate.getFullYear()) {
    return `${format(startDate, SAME_YEAR_RANGE_START_FORMAT)} – ${format(endDate, DATE_FORMAT)}`;
  }

  return `${format(startDate, DATE_FORMAT)} – ${format(endDate, DATE_FORMAT)}`;
}

/**
 * Format a mass value in kg, auto-converting to tonnes when >= 1000.
 * Returns "—" for null/undefined.
 */
export function formatMass(kg: number | null | undefined): string {
  if (kg == null) return FALLBACK_DISPLAY;
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg).toLocaleString()} kg`;
}

/**
 * Format a CO₂e mass in kg with accounting-grade precision — tonnes (up to 3
 * decimals, trailing zeros trimmed) once the magnitude reaches 1 t, otherwise
 * whole kg. Unlike `formatMass` (1-decimal tonnes) this keeps small deltas
 * legible, so a 15 kg uncertainty haircut next to a 1.04 t sequestration both
 * read true. Returns "—" for null/undefined. `signed` prepends +/− (zero stays
 * unsigned). The unit suffix is dropped when `unit` is the empty string.
 */
export function formatCo2e(
  kg: number | null | undefined,
  opts?: { signed?: boolean; unit?: string }
): string {
  if (kg == null || Number.isNaN(kg)) return FALLBACK_DISPLAY;
  const { signed = false, unit } = opts ?? {};
  const abs = Math.abs(kg);
  const inTonnes = abs >= KG_PER_TONNE;
  // Round first, then take the sign from the *displayed* magnitude: a value that
  // rounds to 0 (e.g. 0.4 kg) must read "0 kg CO₂e", never a misleading "+0".
  const roundedMagnitude = inTonnes
    ? Number((abs / KG_PER_TONNE).toFixed(CO2E_TONNES_MAX_FRACTION_DIGITS))
    : Math.round(abs);
  const magnitude = inTonnes
    ? roundedMagnitude.toLocaleString(undefined, {
        maximumFractionDigits: CO2E_TONNES_MAX_FRACTION_DIGITS,
      })
    : roundedMagnitude.toLocaleString();
  const suffix = unit ?? (inTonnes ? "t CO₂e" : "kg CO₂e");
  const sign = signed && roundedMagnitude !== 0 ? (kg > 0 ? "+" : "−") : "";
  return `${sign}${magnitude}${suffix ? ` ${suffix}` : ""}`;
}

/**
 * Format a value already expressed in tonnes (NOT kg — use `formatMass` for kg).
 * Returns "—" for null/undefined. Defaults to 2 decimals and a "t" unit; pass
 * `unit: "t CO₂e"` for stored-carbon displays.
 */
export function formatTonnes(
  value: number | null | undefined,
  opts?: { digits?: number; unit?: string }
): string {
  if (value == null) return FALLBACK_DISPLAY;
  const { digits = 2, unit = "t" } = opts ?? {};
  return `${value.toFixed(digits)} ${unit}`;
}

/**
 * Round a distance in km to a single decimal, locale-grouped, with no unit.
 * Stored distances carry haversine noise (e.g. 61.52174); never surface those
 * raw. Use when the caller appends its own unit casing (e.g. the map's "KM").
 */
export function roundKmDisplay(km: number): string {
  return km.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/**
 * Format a distance in km for display — one decimal, locale-grouped, "km".
 * Returns "—" for null/undefined.
 */
export function formatDistanceKm(km: number | null | undefined): string {
  if (km == null) return FALLBACK_DISPLAY;
  return `${roundKmDisplay(km)} km`;
}

export const BYTES_PER_KB = 1024;
export const BYTES_PER_MB = 1024 * 1024;

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return FALLBACK_DISPLAY;
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}
