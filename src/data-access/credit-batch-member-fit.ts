import type { ProductionRunCreditBatchMemberConflict } from "@/types/production-run-credit-batch-preview";

interface BatchCohort {
  facilityId: string;
  feedstockTypeId: string;
  startDate: string;
  endDate: string;
}

/** Compare complete cohort facts; date strings are facility-local YYYY-MM-DD. */
export function creditBatchMemberConflict(
  batch: BatchCohort,
  run: { facilityId: string; feedstockTypeId: string | null; day: string },
): Exclude<ProductionRunCreditBatchMemberConflict, "reopen"> | null {
  if (run.facilityId !== batch.facilityId) return "facility";
  // null represents an empty or mixed set, neither of which fits one type.
  if (run.feedstockTypeId !== batch.feedstockTypeId) return "feedstock";
  if (run.day < batch.startDate || run.day > batch.endDate) return "outside-window";
  return null;
}
