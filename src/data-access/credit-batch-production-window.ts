import type { CertifierProvider } from "@/schemas/credit-batches";
import { SafeError } from "@/lib/errors";
import { getCreditBatchProductionWindowBounds } from "@/lib/credit-batch-production-window";
import { validateBatchPeriod } from "@/lib/certifier-policy";

export function assertCreditBatchProductionWindow(
  startDate: string | Date,
  endDate: string | Date,
  certifier: CertifierProvider | null,
): { startStr: string; endStr: string } {
  const issue = validateBatchPeriod({ certifier, startDate, endDate });
  if (issue) throw new SafeError(issue);
  return getCreditBatchProductionWindowBounds(startDate, endDate);
}
