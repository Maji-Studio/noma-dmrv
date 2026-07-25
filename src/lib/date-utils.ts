/**
 * Date Formatting Utilities
 *
 * Local-timezone date formatting helpers for form default values.
 * Avoids UTC conversion bugs from toISOString().split("T")[0].
 */

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Fallback IANA zone when a facility's timezone cannot be resolved. Mirrors the
 * `facilities.timezone` column default (`src/db/schema/facilities.ts`) so a
 * missing facility row and a facility that never set a zone behave identically.
 */
export const DEFAULT_FACILITY_TIMEZONE = "UTC";

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

/**
 * Resolve a facility's IANA zone from a facility list. Returns
 * {@link DEFAULT_FACILITY_TIMEZONE} when the facility is unknown — e.g. an edit
 * form opened for a run whose facility is not in the current context list.
 */
export function resolveFacilityTimezone(
  facilities: readonly { id: string; timezone: string }[],
  facilityId: string | null | undefined
): string {
  if (!facilityId) return DEFAULT_FACILITY_TIMEZONE;
  return (
    facilities.find((facility) => facility.id === facilityId)?.timezone ??
    DEFAULT_FACILITY_TIMEZONE
  );
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

/**
 * Combine a date string "YYYY-MM-DD" and a time string "HH:MM" entered against
 * `timeZone` into the UTC instant they denote.
 *
 * `timeZone` is **required** — pass the IANA zone of the facility the value
 * belongs to (`facilities.timezone`). `new Date("YYYY-MM-DDTHH:MM")` is the
 * zoneless date-time form, which the spec parses in the *browser's* zone: an
 * operator on CEST (UTC+2) entering 08:00 for a UTC+3 plant stored 06:00Z
 * instead of 05:00Z, and the telemetry importer — which clips CSV rows to the
 * stored run window — then discarded the readings that fell outside the shifted
 * hour with no error. A defaulted zone is exactly what made that invisible, so
 * callers must name the zone (use {@link DEFAULT_FACILITY_TIMEZONE} explicitly
 * when there is genuinely nothing better).
 *
 * Note the deliberate asymmetry with {@link toDateInputValue} below, which pins
 * *date-only* values to UTC (#46): those persist at UTC midnight and carry no
 * clock, so UTC is their canonical calendar. A date+time pair describes a wall
 * clock at a physical plant, so it resolves in the plant's zone instead.
 */
export function combineDateAndTime(
  dateStr: string,
  timeStr: string,
  timeZone: string
): Date {
  return fromZonedTime(`${dateStr}T${timeStr}`, timeZone);
}

/**
 * Convert a date value (string or Date) to "YYYY-MM-DD" for input[type="date"].
 *
 * Persisted date-only values are stored at UTC midnight, so a `Date`/ISO input
 * must be read on the UTC calendar, not the browser's — otherwise a value like
 * `2026-07-17T00:00:00Z` renders as `2026-07-16` west of UTC and a status-only
 * edit silently saves the shifted day (#46). Plain `YYYY-MM-DD` strings pass
 * through untouched; only the empty/invalid fallback defaults to local today,
 * which is the right "new record" default.
 */
export function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return formatLocalDate(new Date());
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof value === "string" ? new Date(value) : value;
  if (isNaN(date.getTime())) return formatLocalDate(new Date());
  return formatUtcDate(date);
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
