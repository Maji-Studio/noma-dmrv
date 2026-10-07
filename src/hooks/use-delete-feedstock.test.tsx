import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";

const { deleteFeedstockFn } = vi.hoisted(() => ({ deleteFeedstockFn: vi.fn() }));
vi.mock("@/fn/feedstocks", () => ({
  deleteFeedstockFn,
  getFeedstocksFn: vi.fn(),
  getFeedstockByIdFn: vi.fn(),
  getFeedstockStatsFn: vi.fn(),
  createFeedstockFn: vi.fn(),
  updateFeedstockFn: vi.fn(),
}));

import { feedstockKeys, useDeleteFeedstock } from "./use-feedstocks";

const FEEDSTOCK_ID = "33333333-3333-4333-8333-333333333333";
const INITIAL_VERSION = 1;

describe("useDeleteFeedstock", () => {
  it("invalidates the list and refused item's detail and preserves the stale error callback", async () => {
    const variables = { feedstockId: FEEDSTOCK_ID, expectedVersion: INITIAL_VERSION };
    deleteFeedstockFn.mockResolvedValueOnce({
      success: false,
      error: STALE_VERSION_MESSAGE,
      code: "stale_version",
      conflict: { entity: "feedstock", id: FEEDSTOCK_ID, code: STALE_VERSION_CONFLICT_CODE },
    });
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const listKey = feedstockKeys.list({ facilityId: "facility-1" });
    const detailKey = feedstockKeys.detail(FEEDSTOCK_ID);
    const otherDetailKey = feedstockKeys.detail("other-feedstock");
    queryClient.setQueryData(listKey, { items: [{ id: FEEDSTOCK_ID, version: INITIAL_VERSION }] });
    queryClient.setQueryData(detailKey, { id: FEEDSTOCK_ID, version: INITIAL_VERSION });
    queryClient.setQueryData(otherDetailKey, { id: "other-feedstock", version: INITIAL_VERSION });
    const onError = vi.fn();
    function Harness() {
      const mutation = useDeleteFeedstock({ onError });
      return <button onClick={() => mutation.mutateAsync(variables)}>Delete feedstock</button>;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
    });
    try {
      await act(async () => {
        await expect(renderer.root.findByType("button").props.onClick()).rejects.toBeInstanceOf(StaleVersionError);
      });
      expect(deleteFeedstockFn).toHaveBeenCalledWith(variables);
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(otherDetailKey)?.isInvalidated).toBe(false);
      expect(onError).toHaveBeenCalledWith(expect.any(StaleVersionError), variables);
    } finally {
      act(() => renderer.unmount());
      queryClient.clear();
    }
  });
});
