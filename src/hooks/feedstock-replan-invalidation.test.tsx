// @vitest-environment jsdom
/** A feedstock bin stock change re-plans later runs, so run, credit batch, traceability and readiness caches refresh. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { invalidateAfterFeedstockReplan } from "./feedstock-replan-invalidation";
import { useRecordLoss } from "./use-bin-movements";
import { chainOfCustodyKeys } from "./use-chain-of-custody";
import { certificationKeys } from "./use-certification";
import { productionRunKeys } from "./use-production-runs";

const { recordLoss } = vi.hoisted(() => ({ recordLoss: vi.fn() }));
vi.mock("@/fn/bin-movements", () => ({
  getFeedstockBinStockFn: vi.fn(), recordLossFn: recordLoss, removeLossFn: vi.fn(), recordStockTakeFn: vi.fn(),
}));

const KEYS = [
  productionRunKeys.detail("run-1"),
  creditBatchKeys.pageModel("cb-1"),
  creditBatchKeys.emissionLines("fac", "cb-1"),
  chainOfCustodyKeys.batch("cb-1"),
  certificationKeys.overview("fac"),
];

function seeded() {
  const client = new QueryClient();
  for (const key of KEYS) client.setQueryData(key, { cached: true });
  return client;
}

describe("invalidateAfterFeedstockReplan", () => {
  it("invalidates run, credit batch, emissions, traceability and readiness caches", () => {
    const client = seeded();
    invalidateAfterFeedstockReplan(client);
    for (const key of KEYS) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});

describe("useRecordLoss", () => {
  it("refreshes the re-planned views after a saved loss", async () => {
    recordLoss.mockResolvedValueOnce({ success: true, data: {} });
    const client = seeded();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useRecordLoss(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ storageLocationId: "bin" } as never); });
    for (const key of KEYS) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
