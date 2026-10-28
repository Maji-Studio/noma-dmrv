// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import {
  invalidateRecordLocksAfter,
  RECORD_LOCK_TOUCHES,
  recordLockKeys,
  recordLockMeta,
} from "./record-lock-query-keys";
import { useFeedstockTypeLinkLock, useUpdateFeedstockType } from "./use-feedstock-types";

const actions = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }));
vi.mock("@/fn/feedstock-types", () => ({
  getFeedstockTypeLinkLockFn: actions.read,
  updateFeedstockTypeFn: actions.update,
}));
vi.mock("./use-certification", () => ({ certificationKeys: { all: ["certification"] } }));

const TYPE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPEN = { locked: false, removals: [] };
const LOCKED = {
  locked: true,
  removals: [{ id: "removal-1", code: "REM-001", facilityId: "facility-1" }],
};
const UPDATE = { feedstockTypeId: TYPE_ID, expectedVersion: 1, isometricFeedstockTypeId: "fst_replacement" };
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  actions.read.mockReset().mockResolvedValue({ success: true, data: OPEN });
  actions.update.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("feedstock type link lock refresh", () => {
  it("invalidates and refetches the mounted link lock after a registry write", async () => {
    const { result } = renderHook(() => useFeedstockTypeLinkLock(TYPE_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(OPEN));
    expect(client.getQueryData(recordLockKeys.feedstockTypeLink(TYPE_ID))).toEqual(OPEN);
    const inactiveKey = recordLockKeys.feedstockTypeLink("another-type");
    client.setQueryData(inactiveKey, OPEN);
    actions.read.mockResolvedValue({ success: true, data: LOCKED });

    act(() => invalidateRecordLocksAfter(client, { success: true }, null, {
      meta: recordLockMeta(RECORD_LOCK_TOUCHES.registry),
    }));

    expect(client.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
    await waitFor(() => expect(result.current.data).toEqual(LOCKED));
    expect(actions.read).toHaveBeenCalledTimes(2);
    expect(actions.read).toHaveBeenLastCalledWith({ feedstockTypeId: TYPE_ID });
  });

  it("refreshes link locks after an update is refused with certification_locked", async () => {
    const refusal = { success: false, error: "The Isometric link is locked.", code: "certification_locked" } as const;
    actions.update.mockResolvedValue(refusal);
    const { result } = renderHook(() => ({
      lock: useFeedstockTypeLinkLock(TYPE_ID),
      update: useUpdateFeedstockType(),
    }), { wrapper });
    await waitFor(() => expect(result.current.lock.data).toEqual(OPEN));
    const inactiveKey = recordLockKeys.feedstockTypeLink("another-type");
    client.setQueryData(inactiveKey, OPEN);
    actions.read.mockResolvedValue({ success: true, data: LOCKED });

    await act(async () => {
      await expect(result.current.update.mutateAsync(UPDATE)).rejects.toMatchObject(
        new ActionError(refusal),
      );
    });

    expect(client.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
    await waitFor(() => expect(result.current.lock.data).toEqual(LOCKED));
    expect(actions.read).toHaveBeenCalledTimes(2);
    expect(actions.update).toHaveBeenCalledWith(UPDATE);
  });

  it("keeps refreshing link locks after a successful feedstock type update", async () => {
    actions.update.mockResolvedValue({ success: true, data: { id: TYPE_ID, version: 2 } });
    const { result } = renderHook(() => ({
      lock: useFeedstockTypeLinkLock(TYPE_ID),
      update: useUpdateFeedstockType(),
    }), { wrapper });
    await waitFor(() => expect(result.current.lock.data).toEqual(OPEN));
    actions.read.mockResolvedValue({ success: true, data: LOCKED });

    await act(async () => { await result.current.update.mutateAsync(UPDATE); });

    await waitFor(() => expect(result.current.lock.data).toEqual(LOCKED));
    expect(actions.read).toHaveBeenCalledTimes(2);
  });
});
