// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EXACT_ID_FILTER_MAX } from "@/lib/exact-id-filter";
import { useExactIdChunkedList } from "./exact-id-chunked-list";

interface Filters {
  ids?: string[];
  facilityId?: string;
  page?: number;
  pageSize?: number;
}

const STALE_TIME_MS = 30_000;
const EXACT_ID_COUNT = EXACT_ID_FILTER_MAX * 2 + 1;
const ids = Array.from({ length: EXACT_ID_COUNT }, (_, index) => `record-${index}`);
const queryKey = (filters?: Filters) => ["records", "list", filters] as const;
const fetcher = vi.fn(async (filters?: Filters) => ({
  items: filters?.ids?.map((id) => ({ id })) ?? [],
  total: filters?.ids?.length ?? 0,
  page: filters?.page ?? 1,
  pageSize: filters?.pageSize ?? EXACT_ID_FILTER_MAX,
  totalPages: 1,
}));
let client: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function useList(filters?: Filters, enabled?: boolean) {
  return useExactIdChunkedList({
    filters, chunkSize: EXACT_ID_FILTER_MAX, queryKey, fetcher,
    staleTime: STALE_TIME_MS, enabled,
  });
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetcher.mockClear();
});
afterEach(() => { cleanup(); client.clear(); });

it("chunks at the cap, preserves filters and keys, and combines every item", async () => {
  const filters = { ids, facilityId: "facility", page: 4, pageSize: 20 };
  const { result } = renderHook(() => useList(filters), { wrapper: Wrapper });
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  const requests = fetcher.mock.calls.map(([request]) => request);
  expect(requests).toEqual([
    { ...filters, ids: ids.slice(0, EXACT_ID_FILTER_MAX), page: 1, pageSize: EXACT_ID_FILTER_MAX },
    { ...filters, ids: ids.slice(EXACT_ID_FILTER_MAX, EXACT_ID_FILTER_MAX * 2), page: 1, pageSize: EXACT_ID_FILTER_MAX },
    { ...filters, ids: ids.slice(EXACT_ID_FILTER_MAX * 2), page: 1, pageSize: 1 },
  ]);
  expect(result.current.data).toEqual({
    items: ids.map((id) => ({ id })), total: EXACT_ID_COUNT,
    page: 1, pageSize: EXACT_ID_COUNT, totalPages: 1,
  });
  expect(result.current.error).toBeNull();
  for (const request of requests) {
    expect(client.getQueryData(queryKey(request))).toBeDefined();
  }
  renderHook(() => useList(filters), { wrapper: Wrapper });
  expect(fetcher).toHaveBeenCalledTimes(requests.length);
});

it.each([undefined, []])("uses one paged query when ids are %j", async (emptyIds) => {
  const filters = { ids: emptyIds, facilityId: "facility", page: 3, pageSize: 20 };
  const { result } = renderHook(() => useList(filters), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledWith(filters, expect.objectContaining({
    queryKey: queryKey(filters), signal: expect.any(AbortSignal),
  }));
  expect(result.current.data).toBe(client.getQueryData(queryKey(filters)));
  expect(result.current.data).toMatchObject({ page: 3, pageSize: 20 });
});

it("surfaces an error from one chunk alongside the other chunks' items", async () => {
  const error = new Error("Records could not be loaded.");
  fetcher.mockRejectedValueOnce(error);
  const { result } = renderHook(() => useList({ ids }), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.error).toBe(error);
  expect(result.current.data?.items.map((item) => item.id)).toEqual(ids.slice(EXACT_ID_FILTER_MAX));
});

it.each([
  { label: "absent", ids: undefined },
  { label: "empty", ids: [] },
  { label: "chunked", ids },
])("keeps every query disabled when ids are $label", ({ ids: exactIds }) => {
  const { result } = renderHook(() => useList({ ids: exactIds }, false), { wrapper: Wrapper });
  expect(fetcher).not.toHaveBeenCalled();
  expect(result.current.isLoading).toBe(false);
  expect(result.current.error).toBeNull();
  if (exactIds?.length) {
    expect(result.current.data).toEqual({ items: [], total: 0, page: 1, pageSize: 1, totalPages: 0 });
  } else {
    expect(result.current.data).toBeUndefined();
  }
});
