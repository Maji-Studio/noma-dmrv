import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, expect, it, vi } from "vitest";
import { transportDistanceKeys } from "./transport-distance-query-keys";
import { transportLegKeys } from "./use-transport-legs";
import { chainOfCustodyKeys } from "./use-chain-of-custody";
import { useCreateFeedstock, useUpdateFeedstock } from "./use-feedstocks";
import { useCreateDelivery, useUpdateDelivery } from "./use-deliveries";

const ID = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({ ok: (data: unknown) => Promise.resolve({ success: true, data }) }));
vi.mock("@/fn/feedstocks", () => ({
  createFeedstockFn: () => mocks.ok({ feedstocks: [{ id: ID }] }),
  updateFeedstockFn: () => mocks.ok({ id: ID }),
  getFeedstocksFn: vi.fn(), getFeedstockByIdFn: vi.fn(), getFeedstockStatsFn: vi.fn(), deleteFeedstockFn: vi.fn(),
}));
vi.mock("@/fn/deliveries", () => ({
  createDeliveryFn: () => mocks.ok({ id: ID, savedProducts: [] }),
  updateDeliveryFn: () => mocks.ok({ id: ID, savedProducts: [] }),
}));

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const writes = {
  "feedstock create": useCreateFeedstock,
  "feedstock update": useUpdateFeedstock,
  "delivery create": useCreateDelivery,
  "delivery update": useUpdateDelivery,
} as const;

it.each(Object.keys(writes) as (keyof typeof writes)[])(
  "a %s refreshes the recorded leg, its drift read and the routes drawn from it",
  async (write) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const keys = [
      transportLegKeys.byEntity("feedstock", ID),
      transportDistanceKeys.detail({ entityType: "delivery", entityId: ID }),
      chainOfCustodyKeys.detail("application"),
    ];
    for (const key of keys) client.setQueryData(key, []);
    const useWrite = writes[write] as () => { mutateAsync: (input: unknown) => Promise<unknown> };
    const input = { feedstockId: ID, deliveryId: ID, facilityId: "facility", expectedVersion: 1 };
    function Harness() {
      const mutation = useWrite();
      return <button onClick={() => mutation.mutateAsync(input)}>Save</button>;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
    try {
      await act(async () => { await renderer.root.findByType("button").props.onClick(); });
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    } finally {
      act(() => renderer.unmount());
      client.clear();
    }
  },
);
