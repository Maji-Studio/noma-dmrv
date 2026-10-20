// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const BIN_ID = "44444444-4444-4444-8444-444444444444";
const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const read = vi.hoisted(() => ({ resolve: null as ((value: unknown) => void) | null, calls: 0 }));
vi.mock("@/fn/storage-locations", () => ({
  getStorageLocationFn: () => { read.calls += 1; return new Promise((resolve) => { read.resolve = resolve; }); },
}));

import { useAddStockBin } from "./use-add-stock-bin";

const bin = { id: BIN_ID, type: "biochar_bin", facilityId: FACILITY_ID, formulationId: null, archivedAt: null };

describe("useAddStockBin", () => {
  it("settles once the first read answers and stays settled through a refetch", async () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAddStockBin("biochar", FACILITY_ID, true), { wrapper });
    expect(result.current.settling).toBe(false);

    act(() => result.current.request(BIN_ID));
    expect(result.current.settling).toBe(true);
    expect(result.current.bin).toBeNull();

    await act(async () => read.resolve?.({ success: true, data: bin }));
    await waitFor(() => expect(result.current.settling).toBe(false));
    expect(result.current.bin).toEqual({ storageLocationId: BIN_ID, formulationId: null });

    // A refetch in flight keeps the data, so the form it holds back stays open.
    act(() => { void client.invalidateQueries(); });
    await waitFor(() => expect(read.calls).toBe(2));
    expect(result.current.settling).toBe(false);
  });

  it("never waits when the link names no bin", () => {
    const { result } = renderHook(() => useAddStockBin("biochar", FACILITY_ID, true), {
      wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>,
    });
    act(() => result.current.request("not-a-bin-id"));
    expect(result.current.settling).toBe(false);
  });
});
