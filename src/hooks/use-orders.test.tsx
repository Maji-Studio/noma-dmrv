// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { orderKeys, useOrdersForSelect, useUpdateOrder } from "./use-orders";

const mocks = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
vi.mock("@/fn/orders", () => ({ getOrdersForSelectFn: mocks.select, updateOrderFn: mocks.update }));
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
