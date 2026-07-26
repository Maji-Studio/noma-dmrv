import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { creditBatchKeys } from "./credit-batch-query-keys";
import {
  certificationKeys,
  getRemovalCertifyRefetchInterval,
  invalidateCertificationReadiness,
} from "./use-certification";

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
