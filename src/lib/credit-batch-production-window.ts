import { addMonths, isAfter } from "date-fns";
import { formatUtcDate } from "@/lib/date-utils";

export const CREDIT_BATCH_WINDOW_DESCRIPTION = "one calendar month";

function toDateString(value: string | Date): string {
  return typeof value === "string" ? value : formatUtcDate(value);
}

function toUtcDateOnly(value: string | Date): Date {
  const [year, month, day] = toDateString(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function getCreditBatchProductionWindowIssue(
  startDate: string | Date,
  endDate: string | Date,
): string | null {
  const start = toUtcDateOnly(startDate);
  const end = toUtcDateOnly(endDate);

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
  return {
    startStr: formatUtcDate(toUtcDateOnly(startDate)),
    endStr: formatUtcDate(toUtcDateOnly(endDate)),
  };
}
