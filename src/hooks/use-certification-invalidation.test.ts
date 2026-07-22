import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { creditBatchKeys } from "./credit-batch-query-keys";
import {
  certificationKeys,
  invalidateCertificationReadiness,
} from "./use-certification";

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
