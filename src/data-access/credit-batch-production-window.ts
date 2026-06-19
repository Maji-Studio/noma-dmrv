import { formatUtcDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";

const MAX_CREDIT_BATCH_WINDOW_DAYS = 31;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDateString(value: string | Date): string {
  return typeof value === "string" ? value : formatUtcDate(value);
}

function dateStringToUtcMs(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function assertCreditBatchProductionWindow(
  startDate: string | Date,
  endDate: string | Date,
): { startStr: string; endStr: string } {
  const startStr = toDateString(startDate);
  const endStr = toDateString(endDate);

  if (endStr < startStr) {
    throw new SafeError("End date must be after start date");
  }

  const inclusiveDays =
    (dateStringToUtcMs(endStr) - dateStringToUtcMs(startStr)) / MS_PER_DAY + 1;
  if (inclusiveDays > MAX_CREDIT_BATCH_WINDOW_DAYS) {
    throw new SafeError(
      `Credit batch production window must be ${MAX_CREDIT_BATCH_WINDOW_DAYS} days or less`,
    );
  }

  return { startStr, endStr };
}
