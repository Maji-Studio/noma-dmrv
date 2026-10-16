import { getCreditBatchProductionWindowIssue } from "@/lib/credit-batch-production-window";

export { isBatchEligible } from "./isometric";

type BatchPeriod = {
  certifier: string | null;
  startDate: string | Date;
  endDate: string | Date;
};

export function validateBatchPeriod(batch: BatchPeriod): string | null {
  return getCreditBatchProductionWindowIssue(batch.startDate, batch.endDate, {
    enforceMonthCap: batch.certifier === "isometric",
  });
}
