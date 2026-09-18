import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  invalidateOnboardingProgress,
  onboardingKeys,
} from "./use-onboarding";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("invalidateOnboardingProgress", () => {
  it("marks inactive statuses stale without refetching them", async () => {
    const queryClient = createQueryClient();
    const queryKey = onboardingKeys.status("facility-1", "org-1");
    const otherFacilityKey = onboardingKeys.status("facility-2", "org-1");
    const organizationKey = onboardingKeys.status(null, "org-1");
    let doneCount = 2;
    let fetchCount = 0;

    await queryClient.fetchQuery({
      queryKey,
      queryFn: async () => {
        fetchCount += 1;
        return doneCount;
      },
      staleTime: Infinity,
    });
    queryClient.setQueryData(otherFacilityKey, 5);
    queryClient.setQueryData(organizationKey, 1);
    doneCount = 3;

    const result = invalidateOnboardingProgress(queryClient, "facility-1");

    expect(result).toBeUndefined();
    expect(fetchCount).toBe(1);
    expect(queryClient.getQueryData(queryKey)).toBe(2);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(otherFacilityKey)?.isInvalidated,
    ).toBe(false);
    expect(queryClient.getQueryState(organizationKey)?.isInvalidated).toBe(
      false,
    );
  });

  it("invalidates organization-wide and facility statuses for shared setup records", () => {
    const queryClient = createQueryClient();
    const organizationKey = onboardingKeys.status(null, "org-1");
    const facilityKey = onboardingKeys.status("facility-1", "org-1");
    queryClient.setQueryData(organizationKey, 1);
    queryClient.setQueryData(facilityKey, 1);

    invalidateOnboardingProgress(queryClient);

    expect(queryClient.getQueryState(organizationKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(facilityKey)?.isInvalidated).toBe(true);
  });

  it("refreshes an active dashboard status without making the caller wait", async () => {
    const queryClient = createQueryClient();
    const queryKey = onboardingKeys.status("facility-1", "org-1");
    let doneCount = 2;
    let releaseRefresh: (() => void) | undefined;
    let holdRefresh = false;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const queryFn = async () => {
      if (holdRefresh) await refreshGate;
      return doneCount;
    };

    await queryClient.fetchQuery({ queryKey, queryFn, staleTime: Infinity });
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    holdRefresh = true;
    doneCount = 3;

    const result = invalidateOnboardingProgress(queryClient, "facility-1");

    expect(result).toBeUndefined();
    expect(observer.getCurrentResult().isFetching).toBe(true);
    expect(queryClient.getQueryData(queryKey)).toBe(2);

    releaseRefresh?.();
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toBe(3);
      expect(observer.getCurrentResult().isFetching).toBe(false);
    });

    unsubscribe();
    queryClient.clear();
  });

  it("refreshes an invalidated inactive status when the dashboard is revisited", async () => {
    const queryClient = createQueryClient();
    const queryKey = onboardingKeys.status("facility-1", "org-1");
    let doneCount = 2;
    const queryFn = async () => doneCount;

    await queryClient.fetchQuery({ queryKey, queryFn, staleTime: Infinity });
    doneCount = 3;
    invalidateOnboardingProgress(queryClient, "facility-1");

    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toBe(3);
      expect(observer.getCurrentResult().isFetching).toBe(false);
    });

    unsubscribe();
    queryClient.clear();
  });

  it("keeps organization statuses in distinct cache entries", () => {
    expect(onboardingKeys.status(null, "org-1")).not.toEqual(
      onboardingKeys.status(null, "org-2"),
    );
    expect(onboardingKeys.status("facility-1", "org-1")).not.toEqual(
      onboardingKeys.status("facility-1", "org-2"),
    );
  });
});
