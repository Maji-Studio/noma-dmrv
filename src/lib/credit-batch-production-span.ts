import { SafeError } from "@/lib/errors";
import { formatUtcDate } from "@/lib/date-utils";
import { formatDayString } from "@/lib/format-utils";
import { getCreditBatchMonthBoundary, isCreditBatchUnderOneMonth } from "./credit-batch-production-window";

function formatUtcTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

type ProductionSpan = {
  creditBatchCode: string;
  startedAt: string | null;
  endedAt: string | null;
  latestEndingRunCode: string | null;
};

/** Used only at Isometric readiness/submission boundaries. */
export function getCreditBatchProductionSpanIssue(input: ProductionSpan): string | null {
  if (!input.startedAt || !input.endedAt) return null;
  const start = new Date(input.startedAt);
  const end = new Date(input.endedAt);
  if (isCreditBatchUnderOneMonth(start, end)) return null;
  const boundary = getCreditBatchMonthBoundary(start);
  return `Production run ${input.latestEndingRunCode} ends on or after ${formatDayString(formatUtcDate(boundary))}, ${formatUtcTime(boundary)} UTC, so credit batch ${input.creditBatchCode} would cover one month or more. Discard or delete every Removal that holds applied mass from credit batch ${input.creditBatchCode}, including this one. Until then, the Start date and End date of credit batch ${input.creditBatchCode} stay locked. Then shorten those dates so the production runs in credit batch ${input.creditBatchCode} span less than one month. Then create a new Removal.`;
}

/** Throws a SafeError naming the run that pushes any credit batch to a one month span or more. */
export function assertCreditBatchRunSpansUnderOneMonth(inputs: ProductionSpan[]): void {
  for (const input of inputs) {
    const issue = getCreditBatchProductionSpanIssue(input);
    if (issue) throw new SafeError(issue);
  }
}
