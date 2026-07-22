"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchOnboardingStatus } from "@/fn/onboarding";

const ONBOARDING_STATUS_STALE_TIME_MS = 30_000;

export const onboardingKeys = {
  all: ["onboarding"] as const,
  status: (facilityId: string | null) =>
    [...onboardingKeys.all, "status", facilityId] as const,
};

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
    // The guide's CTAs round-trip to entity hubs; the dashboard remounts on
    // return, and none of the entity mutations invalidate onboardingKeys.
    // Refetching on every mount keeps the computed Setup steps honest without
    // wiring invalidations into every create-entity hook.
    refetchOnMount: "always",
  });
}
