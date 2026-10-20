import {
  AmbiguousLocalTimeError,
  combineDateAndTime,
  formatLocalDate,
  formatUtcDate,
  NonexistentLocalTimeError,
} from "@/lib/date-utils";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A 24-hour "HH:MM" wall clock, as `<input type="time">` emits it. */
export const WALL_CLOCK_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type RunWindowValues = {
  startDate: unknown;
  startTime: unknown;
  endDate?: unknown;
  endTime?: unknown;
};

export type RunWindow = {
  start: Date | null;
  end: Date | null;
  startError: string | null;
  endError: string | null;
};

function resolvePair(date: unknown, time: unknown, timeZone: string): { instant: Date | null; error: string | null } {
  if (time instanceof Date) {
    return { instant: Number.isNaN(time.getTime()) ? null : time, error: null };
  }
  if (typeof time !== "string" || !WALL_CLOCK_TIME_RE.test(time)) {
    return { instant: null, error: null };
  }
  // Form schemas parse calendar dates at local midnight; read the same day back.
  const dateStr = date instanceof Date && !Number.isNaN(date.getTime())
    ? formatLocalDate(date)
    : typeof date === "string" ? date : "";
  if (!DATE_ONLY_RE.test(dateStr)) return { instant: null, error: null };
  const calendarDate = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(calendarDate.getTime()) || formatUtcDate(calendarDate) !== dateStr) {
    return { instant: null, error: null };
  }

  try {
    const instant = combineDateAndTime(dateStr, time, timeZone);
    return { instant: Number.isNaN(instant.getTime()) ? null : instant, error: null };
  } catch (error) {
    if (error instanceof NonexistentLocalTimeError || error instanceof AmbiguousLocalTimeError) {
      return { instant: null, error: error.message };
    }
    throw error;
  }
}

/**
 * Resolve form calendar dates and facility wall clocks, or already-combined
 * Date times from server validation. Empty end dates use the start date;
 * earlier end times never roll to the following day implicitly.
 */
export function resolveRunWindow(values: RunWindowValues, timeZone: string): RunWindow {
  const start = resolvePair(values.startDate, values.startTime, timeZone);
  const endDate = values.endDate === "" || values.endDate == null ? values.startDate : values.endDate;
  const end = resolvePair(endDate, values.endTime, timeZone);
  return { start: start.instant, end: end.instant, startError: start.error, endError: end.error };
}
