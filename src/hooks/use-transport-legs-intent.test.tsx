// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useCreateTransportLeg } from "./use-transport-legs";
import type { CreateTransportLegData } from "@/schemas/transport-legs";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/fn/transport-legs", () => ({ createTransportLegFn: create }));
vi.mock("./use-certification", () => ({ invalidateCertificationReadiness: vi.fn() }));
vi.mock("./use-dashboard-overview", () => ({ dashboardOverviewKeys: { all: ["dashboard"] } }));
vi.mock("./use-chain-of-custody", () => ({ chainOfCustodyKeys: { all: ["chain"] } }));
afterEach(cleanup);

// Key keeping and rotation are useIntentMutation's (use-create-intent-key.test.tsx);
// this covers the per-call key that pending Sample legs bring.
it("sends a per-call key as given and the draft key otherwise", async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const { result, rerender, unmount } = renderHook(() => useCreateTransportLeg(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  const input = { entityType: "feedstock", entityId: "parent" } as CreateTransportLegData;
  const explicit = "11111111-1111-4111-8111-111111111111";
  create.mockResolvedValueOnce({ success: false, error: "Save again" })
    .mockResolvedValue({ success: true, data: { id: "leg" } });
  await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow("Save again"); });
  rerender();
  await act(async () => { await result.current.mutateAsync({ ...input, intentKey: explicit }); });
  rerender();
  const keys = create.mock.calls.map(([, options]) => options.intentKey);
  expect(keys[0]).toEqual(expect.any(String));
  expect(keys[0]).not.toBe(explicit);
  expect(keys[1]).toBe(explicit);
  expect(create.mock.calls[1][0]).toEqual(input);
  unmount();
  client.clear();
});
