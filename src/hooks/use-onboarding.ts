"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getOnboardingStatusRead } from "@/lib/read-api/client";

const ONBOARDING_STATUS_STALE_TIME_MS = 30_000;

export const onboardingKeys = {
  all: ["onboarding"] as const,
  statuses: () => [...onboardingKeys.all, "status"] as const,
  facilityStatuses: (facilityId: string) =>
    [...onboardingKeys.statuses(), facilityId] as const,
  status: (facilityId: string | null, organizationId: string | null) =>
    [...onboardingKeys.statuses(), facilityId, organizationId] as const,
};

/**
 * Setup progress is derived from record existence, so every mutation that can
 * satisfy a setup step must invalidate this independent cache.
 */
export function invalidateOnboardingProgress(
  queryClient: QueryClient,
  facilityId?: string,
): void {
  // Mark every matching status stale, but only refetch a status that currently
  // has an observer. Saves must not wait for inactive dashboard queries (or
  // their count-query fan-out); refetchOnMount below refreshes them when the
  // operator returns to the dashboard.
  void queryClient.invalidateQueries({
    queryKey: facilityId
      ? onboardingKeys.facilityStatuses(facilityId)
      : onboardingKeys.all,
    refetchType: "active",
  });
}

export function useOnboardingStatus(
  facilityId: string | null,
  organizationId: string | null,
) {
  return useQuery({
    queryKey: onboardingKeys.status(facilityId, organizationId),
    queryFn: async ({ signal }) => {
      const result = await getOnboardingStatusRead({ facilityId }, { signal });
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: organizationId !== null,
    staleTime: ONBOARDING_STATUS_STALE_TIME_MS,
    // Keep browser-back and route-cache restores honest even if a write came
    // from a path outside the standard entity mutation hooks.
    refetchOnMount: "always",
  });
}
