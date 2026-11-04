// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderKeys, useOrders, useOrdersForSelect, useUpdateOrder } from "./use-orders";

import type { OrderFilterData } from "@/schemas/orders";
import { MAX_ORDER_LIST_SIZE as CHUNK_SIZE } from "@/schemas/orders";

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), list: vi.fn() }));
vi.mock("@/fn/orders", () => ({ getOrdersFn: mocks.list, getOrdersForSelectFn: mocks.select, updateOrderFn: mocks.update }));
afterEach(cleanup);

it("refreshes formulation and destination data in every order-select scope after an update", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const old = { id: "order", formulationId: "old-formulation", destinationName: "Old destination", destinationDistanceKm: 10 };
  const saved = { ...old, formulationId: "new-formulation", destinationName: "New destination", destinationDistanceKm: 20 };
  const scopes = [undefined, "facility", "other-facility"];
  for (const scope of scopes) client.setQueryData(orderKeys.select(scope), [old]);
  mocks.select.mockResolvedValue({ success: true, data: [saved] });
  mocks.update.mockResolvedValue({ success: true, data: { id: "order", version: 2 } });
  const { result, unmount } = renderHook(() => ({
    orders: useOrdersForSelect("facility"),
    update: useUpdateOrder(),
  }), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  expect(result.current.orders.data).toEqual([old]);
  await act(async () => {
    await result.current.update.mutateAsync({ orderId: "order", expectedVersion: 1, formulationId: "new-formulation", customerLocationId: "new-location" });
  });
  await waitFor(() => expect(result.current.orders.data).toEqual([saved]));
  expect(mocks.select).toHaveBeenCalledWith("facility");
  for (const scope of [undefined, "other-facility"]) {
    expect(client.getQueryState(orderKeys.select(scope))?.isInvalidated).toBe(true);
  }
  unmount();
  client.clear();
});

describe("exact order ids", () => {
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
    mocks.list.mockImplementation(async (filters: Partial<OrderFilterData>) => ({
      success: true,
      data: {
        items: filters.ids?.map((id) => ({ id })) ?? [], total: filters.ids?.length ?? 0,
        page: filters.page, pageSize: filters.pageSize, totalPages: 1,
      },
    }));
  });
  afterEach(() => { cleanup(); client.clear(); });

  it("loads every exact id in bounded chunks with scoped query keys", async () => {
    const filters = { ids, facilityId: "facility", search: "OR", page: 4, pageSize: 20 };
    const { result } = renderHook(() => useOrders(filters), { wrapper: Wrapper });
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
    for (const request of requests) expect(client.getQueryData(orderKeys.list(request))).toBeDefined();
  });

  it("preserves ordinary pagination when no exact ids are present", async () => {
    const filters = { facilityId: "facility", page: 3, pageSize: 20 };
    const { result } = renderHook(() => useOrders(filters), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(filters);
    expect(result.current.data).toMatchObject({ page: 3, pageSize: 20 });
  });

  it("preserves ordinary pagination for an empty exact-id filter", async () => {
    const filters = { ids: [], facilityId: "facility", page: 3, pageSize: 20 };
    const { result } = renderHook(() => useOrders(filters), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(filters);
    expect(result.current.data).toMatchObject({ page: 3, pageSize: 20 });
  });

  it("keeps exact-id reads disabled until their facility is ready", () => {
    renderHook(() => useOrders({ ids }, { enabled: false }), { wrapper: Wrapper });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("surfaces a chunk failure instead of hiding it behind the other records", async () => {
    mocks.list.mockImplementation(async (filters: Partial<OrderFilterData>) =>
      filters.ids?.[0] === ids[CHUNK_SIZE]
        ? { success: false, error: "Orders could not be loaded." }
        : { success: true, data: { items: [], total: 0, page: 1, pageSize: CHUNK_SIZE, totalPages: 0 } },
    );
    const { result } = renderHook(() => useOrders({ ids }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.error?.message).toBe("Orders could not be loaded.");
  });

});
