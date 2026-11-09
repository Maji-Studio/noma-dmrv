/**
 * Home for "this kind of change makes these reads stale". Each exported
 * function names one kind of change and refreshes every cached read it can
 * affect. Today it holds certification readiness and emission entry changes;
 * feedstock-replan-invalidation.ts, document-lock-refresh.ts and
 * use-transport-distance-refresh.ts still hold their own. Add new kinds here
 * rather than hand-listing keys in a mutation hook.
 */
import type { QueryClient } from "@tanstack/react-query";
import { activityKeys } from "./activity-query-keys";
import { certificationKeys } from "./certification-query-keys";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { dashboardOverviewKeys } from "./dashboard-overview-query-keys";
import { energyKeys } from "./energy-query-keys";

/** Refresh cached readiness and activity and, when relevant, derived CO₂e previews. */
export function invalidateCertificationReadiness(
  queryClient: QueryClient,
  options?: { creditBatchPreviews?: boolean },
) {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: creditBatchKeys.emissionAllocationPrefix() }),
    queryClient.invalidateQueries({ queryKey: creditBatchKeys.details() }),
    // Removal codes and the not-in-a-Removal mass on the timeline's hover cards.
    queryClient.invalidateQueries({ queryKey: creditBatchKeys.timelineFactsPrefix() }),
    // Readiness-affecting mutations also change the batch activity history.
    queryClient.invalidateQueries({ queryKey: activityKeys.all }),
    queryClient.invalidateQueries({ queryKey: certificationKeys.all }),
    // The dashboard's Needs attention counts draft Removals ("N to fix") from the same readiness.
    queryClient.invalidateQueries({ queryKey: dashboardOverviewKeys.all }),
  ];
  if (options?.creditBatchPreviews) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: creditBatchKeys.previewsPrefix(),
      }),
    );
  }
  return Promise.all(invalidations);
}

/** Kind of change: an emission entry was written, or a file on one was. Everything that reads emission entries. */
export function invalidateEmissionEntryReads(
  queryClient: QueryClient,
  scope: { facilityId: string; creditBatchId: string },
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: creditBatchKeys.emissionLines(scope.facilityId, scope.creditBatchId) }),
    queryClient.invalidateQueries({ queryKey: creditBatchKeys.emissionsOverview(scope.facilityId) }),
    queryClient.invalidateQueries({ queryKey: energyKeys.all }),
    // Batch health, batch-health summaries, the certification overview, removal preflight,
    // activity and the emission allocation previews.
    invalidateCertificationReadiness(queryClient),
  ]);
}
