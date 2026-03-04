/**
 * Date Formatting Utilities
 *
 * Local-timezone date formatting helpers for form default values.
 * Avoids UTC conversion bugs from toISOString().split("T")[0].
 */

/** Format a Date as "YYYY-MM-DD" in local timezone. */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
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

/** Convert a date value (string or Date) to "YYYY-MM-DD" for input[type="date"]. Passes through YYYY-MM-DD strings as-is. */
export function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return formatLocalDate(new Date());
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof value === "string" ? new Date(value) : value;
  if (isNaN(date.getTime())) return formatLocalDate(new Date());
  return formatLocalDate(date);
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
