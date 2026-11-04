// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FeedstockFilterData } from "@/schemas/feedstocks";
import { MAX_FEEDSTOCK_LIST_SIZE as CHUNK_SIZE } from "@/schemas/feedstocks";
import { feedstockKeys, useFeedstocks } from "./use-feedstocks";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/fn/feedstocks", () => ({ getFeedstocksFn: mocks.list }));
vi.mock("./transport-distance-query-keys", () => ({ invalidateRecordedTransport: vi.fn() }));
vi.mock("./use-storage-locations", () => ({ storageLocationKeys: {} }));
vi.mock("./use-onboarding", () => ({ invalidateOnboardingProgress: vi.fn() }));
vi.mock("./feedstock-replan-invalidation", () => ({ invalidateAfterFeedstockReplan: vi.fn() }));

const EXACT_ID_COUNT = CHUNK_SIZE * 2 + 1;
const ids = Array.from({ length: EXACT_ID_COUNT }, (_, index) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
);
let client: QueryClient;
function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.list.mockReset();
  mocks.list.mockImplementation(async (filters: Partial<FeedstockFilterData>) => ({
    success: true,
    data: {
      items: filters.ids?.map((id) => ({ id })) ?? [], total: filters.ids?.length ?? 0,
      page: filters.page, pageSize: filters.pageSize, totalPages: 1,
    },
  }));
});
afterEach(() => { cleanup(); client.clear(); });

it("loads every exact id in bounded chunks with scoped query keys", async () => {
  const filters = { ids, facilityId: "facility", search: "FS", page: 4, pageSize: 20 };
  const { result } = renderHook(() => useFeedstocks(filters), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  const requests = mocks.list.mock.calls.map(([request]) => request);
  expect(requests).toEqual([
    { ...filters, ids: ids.slice(0, CHUNK_SIZE), page: 1, pageSize: CHUNK_SIZE },
    { ...filters, ids: ids.slice(CHUNK_SIZE, CHUNK_SIZE * 2), page: 1, pageSize: CHUNK_SIZE },
    { ...filters, ids: ids.slice(CHUNK_SIZE * 2), page: 1, pageSize: 1 },
  ]);
  expect(result.current.error).toBeNull();
  expect(result.current.data).toMatchObject({ total: EXACT_ID_COUNT, page: 1, pageSize: EXACT_ID_COUNT, totalPages: 1 });
  expect(result.current.data?.items.map((item) => item.id)).toEqual(ids);
  for (const request of requests) expect(client.getQueryData(feedstockKeys.list(request))).toBeDefined();
});

it("preserves ordinary pagination when no exact ids are present", async () => {
  const filters = { facilityId: "facility", page: 3, pageSize: 20 };
  const { result } = renderHook(() => useFeedstocks(filters), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith(filters);
  expect(result.current.data).toMatchObject({ page: 3, pageSize: 20 });
});

it("preserves ordinary pagination for an empty exact-id filter", async () => {
  const filters = { ids: [], facilityId: "facility", page: 3, pageSize: 20 };
  const { result } = renderHook(() => useFeedstocks(filters), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith(filters);
  expect(result.current.data).toMatchObject({ page: 3, pageSize: 20 });
});

it("keeps exact-id reads disabled until their facility is ready", () => {
  renderHook(() => useFeedstocks({ ids }, { enabled: false }), { wrapper: Wrapper });
  expect(mocks.list).not.toHaveBeenCalled();
});

it("surfaces a chunk failure instead of hiding it behind the other records", async () => {
  mocks.list.mockImplementation(async (filters: Partial<FeedstockFilterData>) =>
    filters.ids?.[0] === ids[CHUNK_SIZE]
      ? { success: false, error: "Feedstocks could not be loaded." }
      : { success: true, data: { items: [], total: 0, page: 1, pageSize: CHUNK_SIZE, totalPages: 0 } },
  );
  const { result } = renderHook(() => useFeedstocks({ ids }), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(result.current.error?.message).toBe("Feedstocks could not be loaded.");
});
