// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { getEmissionAllocationFn } from "@/fn/emission-allocation";
import { useEmissionAllocation } from "./use-emission-allocation";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { invalidateEmissionEntryReads } from "./use-emission-entries";
import { invalidateCertificationReadiness } from "./use-certification";

vi.mock("@/fn/emission-allocation", () => ({ getEmissionAllocationFn: vi.fn() }));

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

describe("useEmissionAllocation", () => {
  it("waits for a scope and reads the anchored facility model", async () => {
    const model = { facilityId: "facility", batches: [], removals: [], records: [] };
    vi.mocked(getEmissionAllocationFn).mockResolvedValue({ success: true, data: model });
    const { wrapper } = harness();
    const { result, rerender } = renderHook(({ enabled }) => useEmissionAllocation(enabled ? { removalId: "removal" } : null), {
      wrapper, initialProps: { enabled: false },
    });
    expect(getEmissionAllocationFn).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toEqual(model));
    expect(getEmissionAllocationFn).toHaveBeenCalledExactlyOnceWith({ removalId: "removal" });
  });

  it("invalidates both anchors after an entry write and after run or readiness changes", async () => {
    const { client } = harness();
    const keys = [creditBatchKeys.emissionAllocation({ creditBatchId: "batch" }), creditBatchKeys.emissionAllocation({ removalId: "removal" })];
    for (const invalidate of [
      () => invalidateEmissionEntryReads(client, { facilityId: "facility", creditBatchId: "batch" }),
      () => invalidateCertificationReadiness(client),
    ]) {
      for (const key of keys) client.setQueryData(key, { cached: true });
      await act(async () => { await invalidate(); });
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
