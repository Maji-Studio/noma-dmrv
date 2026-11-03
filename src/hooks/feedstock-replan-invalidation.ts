import type { QueryClient } from "@tanstack/react-query";
import { activityKeys } from "./activity-query-keys";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { chainOfCustodyKeys } from "./use-chain-of-custody";
import { certificationKeys } from "./use-certification";
import { dashboardOverviewKeys } from "./use-dashboard-overview";
import { productionRunKeys } from "./use-production-runs";

/**
 * A feedstock bin's stock changed (intake, lost mass, stock count, loss correction, product ingredient).
 * Later runs in the bin are re-planned, so their delivery shares and the credit batch transport they carry
 * change. Refresh every cached view that shows those figures.
 */
export function invalidateAfterFeedstockReplan(queryClient: QueryClient) {
  for (const queryKey of [
    productionRunKeys.all,
    creditBatchKeys.all,
    chainOfCustodyKeys.all,
    certificationKeys.all,
    dashboardOverviewKeys.all,
    activityKeys.all,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
