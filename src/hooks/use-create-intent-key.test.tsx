// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useCreateApplication } from "./use-applications";
import type { ApplicationFormData } from "@/schemas/applications";
import { useCreateIntentKey } from "./use-create-intent-key";
import { useCreateOrder } from "./use-orders";
import type { CreateOrderData } from "@/schemas/orders";

const { create, createApplication } = vi.hoisted(() => ({ create: vi.fn(), createApplication: vi.fn() }));
vi.mock("@/fn/applications", () => ({ createApplicationFn: createApplication }));
vi.mock("./use-credit-batches", async () => import("./credit-batch-query-keys"));
vi.mock("./use-certification", () => ({ invalidateCertificationReadiness: vi.fn() }));
vi.mock("@/fn/chain-of-custody", () => ({}));
vi.mock("@/fn/orders", () => ({ createOrderFn: create }));
afterEach(cleanup);

it("reuses the draft key after failure and rotates after success, including across rerenders", async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const { result, rerender, unmount } = renderHook(() => useCreateOrder(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  const input = {} as CreateOrderData;
  create.mockResolvedValueOnce({ success: false, code: "outcome_unknown", error: "Save again" })
    .mockResolvedValue({ success: true, data: { id: "order" } });
  await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow("Save again"); });
  rerender();
  await act(async () => { await result.current.mutateAsync(input); });
  rerender();
  await act(async () => { await result.current.mutateAsync(input); });
  const keys = create.mock.calls.map(([, options]) => options.intentKey);
  expect(keys[0]).toEqual(expect.any(String));
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
  unmount();
  client.clear();
});

it("keeps an application intent when its action returns a failure result", async () => {
  const client = new QueryClient();
  const { result, unmount } = renderHook(() => useCreateApplication(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  createApplication.mockResolvedValueOnce({ success: false, error: "Save again" })
    .mockResolvedValue({ success: true, data: { id: "application" } });
  const input = {} as ApplicationFormData;
  await act(async () => { await result.current.mutateAsync(input); });
  await act(async () => { await result.current.mutateAsync(input); });
  await act(async () => { await result.current.mutateAsync(input); });
  const keys = createApplication.mock.calls.map(([, options]) => options.intentKey);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
  unmount();
  client.clear();
});

it("mints lazily and keeps separate keys for separate hook instances", () => {
  const uuid = vi.spyOn(crypto, "randomUUID");
  const { result, rerender } = renderHook(() => ({ first: useCreateIntentKey(), second: useCreateIntentKey() }));
  expect(uuid).not.toHaveBeenCalled();
  const first = result.current.first.current();
  const second = result.current.second.current();
  expect(second).not.toBe(first);
  rerender();
  expect(result.current.first.current()).toBe(first);
  expect(result.current.second.current()).toBe(second);
});
