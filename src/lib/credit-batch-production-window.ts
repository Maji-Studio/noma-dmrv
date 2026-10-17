import { isAfter } from "date-fns/isAfter";
import { formatUtcDate } from "@/lib/date-utils";
import { formatDayString } from "@/lib/format-utils";

// noma conservative Isometric production-window rule; see docs/adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md.
const MONTH_CAP = 1;
const PREVIOUS_DAY = 1;

/** UTC calendar arithmetic, clamped like PostgreSQL date + interval '1 month'.
 * Preserve the time for physical run spans; date windows pass UTC midnight.
 */
export function getCreditBatchMonthBoundary(start: Date): Date {
  const boundary = new Date(start);
  boundary.setUTCDate(1);
  boundary.setUTCMonth(boundary.getUTCMonth() + MONTH_CAP);
  const lastDay = new Date(boundary);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + MONTH_CAP, 0);
  boundary.setUTCDate(Math.min(start.getUTCDate(), lastDay.getUTCDate()));
  return boundary;
}

export function isCreditBatchUnderOneMonth(start: Date, end: Date): boolean {
  return end < getCreditBatchMonthBoundary(start);
}

function toDateString(value: string | Date): string {
  return typeof value === "string" ? value : formatUtcDate(value);
}

function toUtcDateOnly(value: string | Date): Date {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(toDateString(value));
  if (!match) throw new Error("Enter a valid date.");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("Enter a valid date.");
  }
  return parsed;
}

export function getCreditBatchProductionWindowIssue(
  startDate: string | Date,
  endDate: string | Date,
  options: { enforceMonthCap: boolean } = { enforceMonthCap: true },
): string | null {
  let start: Date;
  let end: Date;
  try {
    start = toUtcDateOnly(startDate);
    end = toUtcDateOnly(endDate);
  } catch {
    return "Enter a valid date.";
  }

  if (isAfter(start, end)) {
    return "End date must be after start date";
  }

  if (options.enforceMonthCap && !isCreditBatchUnderOneMonth(start, end)) {
    const lastAllowed = getCreditBatchMonthBoundary(start);
    lastAllowed.setUTCDate(lastAllowed.getUTCDate() - PREVIOUS_DAY);
    return `Choose an end date on or before ${formatDayString(formatUtcDate(lastAllowed))}. Isometric credit batches must cover less than one month.`;
  }

  return null;
}

export function getCreditBatchProductionWindowBounds(
  startDate: string | Date,
  endDate: string | Date,
): { startStr: string; endStr: string } {
  const start = toUtcDateOnly(startDate);
  const end = toUtcDateOnly(endDate);
  return {
    startStr: formatUtcDate(start),
    endStr: formatUtcDate(end),
  };
}
