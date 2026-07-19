const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize a Date or parseable timestamp string to its ISO UTC calendar day.
 * Exact valid date-only strings pass through without timezone interpretation.
 */
export function toIsoUtcCalendarDay(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }

  if (typeof value !== "string") return null;

  if (ISO_DATE_ONLY_PATTERN.test(value)) {
    const parsedDateOnly = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsedDateOnly.getTime()) &&
      parsedDateOnly.toISOString().slice(0, 10) === value
      ? value
      : null;
  }

  const parsedTimestamp = new Date(value);
  return Number.isNaN(parsedTimestamp.getTime())
    ? null
    : parsedTimestamp.toISOString().slice(0, 10);
}
