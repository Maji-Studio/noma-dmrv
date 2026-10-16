import { activityKeys } from "./activity-query-keys";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { onboardingKeys } from "./use-onboarding";
import { SubmissionStreamStalledError } from "@/lib/certification/submission-progress-client";

const reactQueryMocks = vi.hoisted(() => ({
  useQueries: vi.fn(),
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, ...reactQueryMocks };
});

import {
  certificationKeys,
  getRemovalCertifyRefetchInterval,
  getRemovalPreflightRefetchInterval,
  invalidateCertificationReadiness,
  useRemovalPreflightSummaries,
  useSaveFacilityCertifierMapping,
  useSubmitGhgStatementToVerifier,
} from "./use-certification";

describe("certificationKeys", () => {
  it("keys removal enrichment by selected facility and removal id", () => {
    expect(
      certificationKeys.removalPreflight("facility-1", "removal-1"),
    ).toEqual([
      "certification",
      "removal-preflight",
      "facility-1",
      "removal-1",
    ]);
  });
});

describe("useSaveFacilityCertifierMapping", () => {
  it("invalidates adopted batch rows, previews and activity alongside mapping and onboarding caches", async () => {
    const queryClient = new QueryClient();
    reactQueryMocks.useQueryClient.mockReturnValue(queryClient);
    reactQueryMocks.useMutation.mockClear();
    const facilityId = "facility-1";
    const batchId = "batch-1";
    const affectedKeys = [
      certificationKeys.facilityMapping(facilityId),
      certificationKeys.certifyContextForCreditBatch(batchId),
      onboardingKeys.status(facilityId, "org-1"),
      creditBatchKeys.list({ facilityId }),
      creditBatchKeys.detail(batchId),
      creditBatchKeys.previews([batchId]),
      activityKeys.creditBatch(batchId),
      activityKeys.creditBatchSummary(batchId),
    ];
    for (const key of affectedKeys) {
      queryClient.setQueryData(key, { certifier: null, version: 1 });
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
    }

    useSaveFacilityCertifierMapping();

    const [{ onSuccess }] = reactQueryMocks.useMutation.mock.calls[0] as [{
      onSuccess: (data: unknown, variables: { facilityId: string }) => void;
    }];
    await onSuccess({}, { facilityId });

    for (const key of affectedKeys) {
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    }
    queryClient.clear();
  });
});

describe("useSubmitGhgStatementToVerifier", () => {
  it.each([
    new Error("Submit failed"),
    new SubmissionStreamStalledError(),
  ])("refreshes certification queries after $name", async (error) => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    reactQueryMocks.useQueryClient.mockReturnValue({ invalidateQueries });
    reactQueryMocks.useMutation.mockClear();

    useSubmitGhgStatementToVerifier();

    const [{ onError }] = reactQueryMocks.useMutation.mock.calls[0] as [{
      onError: (error: Error) => void;
    }];
    await onError(error);
    expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({
      queryKey: certificationKeys.all,
    });
  });
});

describe("getRemovalCertifyRefetchInterval", () => {
  it("polls only for a locked submission or future measurement blocker", () => {
    expect(getRemovalCertifyRefetchInterval(undefined)).toBe(false);
    expect(
      getRemovalCertifyRefetchInterval({
        latestSubmission: null,
        futureDatedMeasurements: [],
      }),
    ).toBe(false);
    expect(
      getRemovalCertifyRefetchInterval({
        latestSubmission: { lockedAt: new Date() },
        futureDatedMeasurements: [],
      }),
    ).toBe(60_000);
    expect(
      getRemovalCertifyRefetchInterval({
        latestSubmission: null,
        futureDatedMeasurements: ["Application APP-1 is dated in the future."],
      }),
    ).toBe(60_000);
  });
});

describe("getRemovalPreflightRefetchInterval", () => {
  it("polls only while the removal submission lock is in flight", () => {
    expect(getRemovalPreflightRefetchInterval(undefined)).toBe(false);
    expect(
      getRemovalPreflightRefetchInterval({ lockInFlight: false }),
    ).toBe(false);
    expect(getRemovalPreflightRefetchInterval({ lockInFlight: true })).toBe(
      60_000,
    );
  });

  it("is wired into every removal preflight query", () => {
    reactQueryMocks.useQueries.mockReturnValue([
      { data: undefined, isError: false, refetch: vi.fn() },
      { data: undefined, isError: false, refetch: vi.fn() },
    ]);

    useRemovalPreflightSummaries("facility-1", ["removal-1", "removal-2"]);

    const [{ queries }] = reactQueryMocks.useQueries.mock.calls[0] as [{
      queries: Array<{
        refetchInterval: (query: {
          state: { data: { lockInFlight: boolean } | undefined };
        }) => number | false;
      }>;
    }];
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(
        query.refetchInterval({ state: { data: { lockInFlight: true } } }),
      ).toBe(60_000);
      expect(
        query.refetchInterval({ state: { data: { lockInFlight: false } } }),
      ).toBe(false);
    }
  });
});

describe("invalidateCertificationReadiness", () => {
  it("invalidates certification and activity projections by default", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await invalidateCertificationReadiness(queryClient);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: activityKeys.all });

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: certificationKeys.all,
    });
  });

  it("also invalidates CO₂e previews for chemistry and mass inputs", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await invalidateCertificationReadiness(queryClient, {
      creditBatchPreviews: true,
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: certificationKeys.all,
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: creditBatchKeys.previewsPrefix(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: creditBatchKeys.details(),
    });
  });
});
