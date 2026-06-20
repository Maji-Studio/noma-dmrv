import { SafeError } from "@/lib/errors";
import {
  getCreditBatchProductionWindowBounds,
  getCreditBatchProductionWindowIssue,
} from "@/lib/credit-batch-production-window";

export function assertCreditBatchProductionWindow(
  startDate: string | Date,
  endDate: string | Date,
): { startStr: string; endStr: string } {
  const issue = getCreditBatchProductionWindowIssue(startDate, endDate);
  if (issue) throw new SafeError(issue);
  return getCreditBatchProductionWindowBounds(startDate, endDate);
}
