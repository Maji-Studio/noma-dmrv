import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { creditBatchKeys } from "./credit-batch-query-keys";

const reactQueryMocks = vi.hoisted(() => ({
  useQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQueries: reactQueryMocks.useQueries };
});

import {
  certificationKeys,
  getRemovalCertifyRefetchInterval,
  getRemovalPreflightRefetchInterval,
  invalidateCertificationReadiness,
  useRemovalPreflightSummaries,
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
  it("invalidates certification projections only by default", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await invalidateCertificationReadiness(queryClient);

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
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

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
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
