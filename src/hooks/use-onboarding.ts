"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { fetchOnboardingStatus } from "@/fn/onboarding";

const ONBOARDING_STATUS_STALE_TIME_MS = 30_000;

export const onboardingKeys = {
  all: ["onboarding"] as const,
  status: (facilityId: string | null) =>
    [...onboardingKeys.all, "status", facilityId] as const,
};

/**
 * Setup progress is derived from record existence, so every mutation that can
 * satisfy a setup step must invalidate this independent cache.
 */
export function invalidateOnboardingProgress(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: onboardingKeys.all,
    // Setup CTAs create records on another route. Refresh inactive dashboard
    // queries too, and let mutateAsync wait for the new progress before it
    // navigates or closes the create surface.
    refetchType: "all",
  });
}

export function useOnboardingStatus(facilityId: string | null) {
  return useQuery({
    queryKey: onboardingKeys.status(facilityId),
    queryFn: async () => {
      const result = await fetchOnboardingStatus({ facilityId });
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    staleTime: ONBOARDING_STATUS_STALE_TIME_MS,
    // Keep browser-back and route-cache restores honest even if a write came
    // from a path outside the standard entity mutation hooks.
    refetchOnMount: "always",
  });
}
