/**
 * Date Formatting Utilities
 *
 * Local-timezone date formatting helpers for form default values.
 * Avoids UTC conversion bugs from toISOString().split("T")[0].
 */

import { formatInTimeZone } from "date-fns-tz";

// ============================================
// Facility Timezone Display Helpers
// ============================================

/** Format a UTC date in a facility's local timezone. */
export function formatFacilityTime(
  utcDate: Date,
  timezone: string,
  fmt = "yyyy-MM-dd HH:mm"
): string {
  return formatInTimeZone(utcDate, timezone, fmt);
}

/** Format a UTC date as date-only in a facility's local timezone. */
export function formatFacilityDate(utcDate: Date, timezone: string): string {
  return formatInTimeZone(utcDate, timezone, "yyyy-MM-dd");
}

/** Get the UTC offset label for an IANA timezone, e.g. "UTC+3" or "UTC-5". */
export function getUtcOffsetLabel(timezone: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  }).formatToParts(now);
  const offsetPart = parts.find((p) => p.type === "timeZoneName");
  // Returns e.g. "GMT+3" — normalise to "UTC+3"
  return offsetPart?.value.replace("GMT", "UTC") ?? "UTC";
}

/** Format an IANA timezone for dropdown display, e.g. "Africa/Nairobi (UTC+3)". */
export function formatTimezoneLabel(timezone: string): string {
  const readable = timezone.replace(/_/g, " ");
  const offset = getUtcOffsetLabel(timezone);
  return `${readable} (${offset})`;
}

/** Format a Date as "YYYY-MM-DD" in local timezone. */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Format a Date as "YYYY-MM-DD" in UTC. Use for matching against backend-stored UTC date strings. */
export function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Format a Date as "YYYY-MM-DDTHH:MM" in local timezone. */
export function formatLocalDateTime(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

/** Format a Date as "HH:MM" in local timezone (for time inputs). */
export function formatLocalTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${mi}`;
}

/** Combine a date string "YYYY-MM-DD" and time string "HH:MM" into a Date. */
export function combineDateAndTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}`);
}

/** Convert a date value (string or Date) to "YYYY-MM-DD" for input[type="date"]. Passes through YYYY-MM-DD strings as-is. */
export function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return formatLocalDate(new Date());
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof value === "string" ? new Date(value) : value;
  if (isNaN(date.getTime())) return formatLocalDate(new Date());
  return formatLocalDate(date);
}

/**
 * Returns a "YYYY-MM-DD" string shifted by `days`, treating the input as a UTC
 * calendar date so the result is purely arithmetic (no timezone drift). Used to
 * derive a GHG-statement reporting-period start from the prior period's end.
 */
export function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Parse a "YYYY-MM-DD" string as a local date (avoids UTC midnight shift). */
export function parseLocalDateString(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  return date;
}
