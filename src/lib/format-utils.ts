/**
 * Shared formatting utilities for display values
 */

import { format, isValid, parseISO } from "date-fns";

/**
 * Format a mass value in kg, auto-converting to tonnes when >= 1000.
 * Returns "—" for null/undefined.
 */
export function formatMass(kg: number | null | undefined): string {
  if (kg == null) return "—";
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`;
  return `${Math.round(kg).toLocaleString()} kg`;
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
  if (value == null) return "—";
  const { digits = 2, unit = "t" } = opts ?? {};
  return `${value.toFixed(digits)} ${unit}`;
}

/**
 * Safely format a date string or Date object.
 * Returns "—" for invalid/null dates.
 */
export function formatSafeDate(
  dateStr: string | Date | null | undefined,
  fmt = "MMM d, yyyy"
): string {
  if (!dateStr) return "—";
  const date = typeof dateStr === "string" ? parseISO(dateStr) : dateStr;
  return isValid(date) ? format(date, fmt) : "—";
}

/**
 * Build a pagination label like "1-12 of 36 items".
 */
export function getPaginationLabel(
  page: number,
  pageSize: number,
  total: number,
  entityLabel: string
): string {
  if (total === 0) return `No ${entityLabel}`;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return `${start}-${end} of ${total} ${entityLabel}`;
}

export const BYTES_PER_KB = 1024;
export const BYTES_PER_MB = 1024 * 1024;

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / BYTES_PER_KB).toFixed(1)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}
