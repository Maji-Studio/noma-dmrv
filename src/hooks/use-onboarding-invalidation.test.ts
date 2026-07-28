import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  invalidateOnboardingProgress,
  onboardingKeys,
} from "./use-onboarding";

describe("invalidateOnboardingProgress", () => {
  it("refreshes an inactive dashboard status after a setup entity is created", async () => {
    const queryClient = new QueryClient();
    const queryKey = onboardingKeys.status("facility-1");
    let doneCount = 2;

    await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => doneCount,
      staleTime: Infinity,
    });
    doneCount = 3;

    await invalidateOnboardingProgress(queryClient);

    expect(queryClient.getQueryData(queryKey)).toBe(3);
  });
});
