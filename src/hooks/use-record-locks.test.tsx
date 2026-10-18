// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordLockKeys } from "./record-lock-query-keys";

const read = vi.hoisted(() => ({ getRecordLocksRead: vi.fn() }));
vi.mock("@/lib/read-api/client", () => read);

import { useRecordLock } from "./use-record-locks";

const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPEN = { level: "open", heldBy: [], usedBy: [], freeFields: [], howToFree: null, returnedBy: [] };

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => read.getRecordLocksRead.mockReset());

describe("useRecordLock", () => {
  it("answers a lock asked for by an upper-case id", async () => {
    read.getRecordLocksRead.mockResolvedValue({ success: true, data: { [ORDER_ID]: OPEN } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRecordLock("order", ORDER_ID.toUpperCase()), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.lock).toEqual(OPEN);
    expect(read.getRecordLocksRead).toHaveBeenCalledWith({ entityType: "order", ids: [ORDER_ID] }, expect.anything());
  });

  it("fails closed when a refresh of a cached lock fails", async () => {
    read.getRecordLocksRead.mockResolvedValueOnce({ success: true, data: { [ORDER_ID]: OPEN } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRecordLock("order", ORDER_ID), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.lock).toEqual(OPEN));

    read.getRecordLocksRead.mockResolvedValueOnce({ success: false, error: "Record locks could not be loaded." });
    await act(() => client.invalidateQueries({ queryKey: recordLockKeys.all }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    // The cached Open must not authorize Edit or Delete any more.
    expect(result.current.lock).toBeUndefined();
  });
});
