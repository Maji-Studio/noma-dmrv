const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE_PREFILTER_PADDING_DAYS = 1;
const INCLUSIVE_END_DAYS = 1;

/** Widen local calendar days so an indexed UTC timestamp bound loses no runs. */
export function productionRunDateBounds(startDay?: string, endDay?: string) {
  return {
    start: startDay
      ? new Date(Date.parse(startDay) - TIMEZONE_PREFILTER_PADDING_DAYS * DAY_MS)
      : undefined,
    endExclusive: endDay
      ? new Date(Date.parse(endDay) + (INCLUSIVE_END_DAYS + TIMEZONE_PREFILTER_PADDING_DAYS) * DAY_MS)
      : undefined,
  };
}
