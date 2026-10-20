// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRecordCreditBatchesFn } from "@/fn/record-credit-batches";
import { useRecordCreditBatches } from "./use-record-credit-batches";

vi.mock("@/fn/record-credit-batches", () => ({ getRecordCreditBatchesFn: vi.fn() }));

const RECORD_ID = "aa989267-fc30-4bcf-a76b-263a6b4ee4ac";
const OTHER_ID = "5c5e0dd7-31db-4cbd-b99a-e27fd3de047a";
const BATCH = { id: OTHER_ID, code: "CB-001", startDate: "2025-01-01", endDate: "2025-01-15" };

function wrapper() {
  const client = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useRecordCreditBatches", () => {
  it.each([undefined, null, ""])("never calls the server without a saved ID (%s), even on refetch", async id => {
    const { result } = renderHook(() => useRecordCreditBatches("feedstock", id), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe("idle");
    await act(async () => { await result.current.refetch(); });
    expect(getRecordCreditBatchesFn).not.toHaveBeenCalled();
  });

  it("fetches saved provenance and clears the prior response when the ID changes", async () => {
    vi.mocked(getRecordCreditBatchesFn)
      .mockResolvedValueOnce({ success: true, data: { batches: [BATCH], heldOut: false } })
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ id }) => useRecordCreditBatches("delivery", id), {
      initialProps: { id: RECORD_ID }, wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data).toEqual({ batches: [BATCH], heldOut: false }));
    rerender({ id: OTHER_ID });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(getRecordCreditBatchesFn).toHaveBeenLastCalledWith({ kind: "delivery", id: OTHER_ID }));
  });

  it("separates kinds in the query cache", async () => {
    vi.mocked(getRecordCreditBatchesFn).mockResolvedValue({ success: true, data: { batches: [], heldOut: false } });
    const { result } = renderHook(() => ({
      feedstock: useRecordCreditBatches("feedstock", RECORD_ID),
      application: useRecordCreditBatches("application", RECORD_ID),
    }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.application.isSuccess && result.current.feedstock.isSuccess).toBe(true));
    expect(getRecordCreditBatchesFn).toHaveBeenCalledWith({ kind: "feedstock", id: RECORD_ID });
    expect(getRecordCreditBatchesFn).toHaveBeenCalledWith({ kind: "application", id: RECORD_ID });
  });

  it("exposes a failed lookup as an error, without inventing an empty result or retrying", async () => {
    vi.mocked(getRecordCreditBatchesFn).mockResolvedValue({ success: false, error: "Lookup unavailable" });
    const { result } = renderHook(() => useRecordCreditBatches("application", RECORD_ID), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Lookup unavailable");
    expect(result.current.data).toBeUndefined();
    expect(getRecordCreditBatchesFn).toHaveBeenCalledTimes(1);
  });
});
