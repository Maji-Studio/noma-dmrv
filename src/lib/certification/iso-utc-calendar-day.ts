const ISO_DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS_PER_YEAR = 12;
const FEBRUARY = 2;
const LEAP_YEAR_DAY = 29;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const LEAP_YEAR_INTERVAL = 4;
const LEAP_YEAR_CENTURY_INTERVAL = 100;
const LEAP_YEAR_CYCLE = 400;

function isLeapYear(year: number): boolean {
  return (
    year % LEAP_YEAR_CYCLE === 0 ||
    (year % LEAP_YEAR_INTERVAL === 0 &&
      year % LEAP_YEAR_CENTURY_INTERVAL !== 0)
  );
}

function isValidIsoCalendarDay(value: string): boolean {
  const match = ISO_DATE_ONLY_PATTERN.exec(value);
  if (match == null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > MONTHS_PER_YEAR) return false;

  const maximumDay =
    month === FEBRUARY && isLeapYear(year)
      ? LEAP_YEAR_DAY
      : DAYS_PER_MONTH[month - 1];
  return maximumDay != null && day >= 1 && day <= maximumDay;
}

function toUtcCalendarDay(value: Date): string | null {
  if (Number.isNaN(value.getTime())) return null;

  const calendarDay = value.toISOString().slice(0, 10);
  return isValidIsoCalendarDay(calendarDay) ? calendarDay : null;
}

/**
 * Normalize a Date or parseable timestamp string to its ISO UTC calendar day.
 * Exact valid date-only strings pass through without timezone interpretation.
 */
export function toIsoUtcCalendarDay(value: unknown): string | null {
  if (value instanceof Date) {
    return toUtcCalendarDay(value);
  }

  if (typeof value !== "string") return null;

  if (ISO_DATE_ONLY_PATTERN.test(value)) {
    return isValidIsoCalendarDay(value) ? value : null;
  }

  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (match == null) return null;

  const [, calendarDay, hourText, minuteText, secondText, fraction, zone] =
    match;
  if (calendarDay == null || !isValidIsoCalendarDay(calendarDay)) return null;

  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    hour >= HOURS_PER_DAY ||
    minute >= MINUTES_PER_HOUR ||
    second >= SECONDS_PER_MINUTE
  ) {
    return null;
  }

  if (zone == null) return calendarDay;

  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(-2));
    if (
      offsetHour >= HOURS_PER_DAY ||
      offsetMinute >= MINUTES_PER_HOUR
    ) {
      return null;
    }
  }

  const normalizedTimestamp = `${calendarDay}T${hourText}:${minuteText}:${secondText}${fraction ?? ""}${zone}`;
  return toUtcCalendarDay(new Date(normalizedTimestamp));
}
