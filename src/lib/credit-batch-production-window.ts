import { addMonths, isAfter } from "date-fns";
import { formatUtcDate } from "@/lib/date-utils";

export const CREDIT_BATCH_WINDOW_DESCRIPTION = "one calendar month";

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

  if (isAfter(end, addMonths(start, 1))) {
    return `A credit batch may span at most one month (${CREDIT_BATCH_WINDOW_DESCRIPTION}; Isometric production batch, §8.3.1)`;
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
