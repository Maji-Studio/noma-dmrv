import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { useRefreshTransportDistance, transportDistanceKeys } from "./use-transport-distance-refresh";
import { feedstockKeys } from "./use-feedstocks";
import { deliveryKeys } from "./use-deliveries";
import { transportLegKeys } from "./use-transport-legs";
import { StaleVersionError } from "@/lib/stale-version";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/fn/transport-distance-refresh", () => ({ refreshFeedstockDistanceFn: mocks.refresh, refreshDeliveryDistanceFn: mocks.refresh, getTransportDistanceDriftFn: vi.fn() }));

it.each([true, false])("refresh cache and concurrency behavior, success=%s", async success => {
  const input = { entityId: "feedstock-id", expectedVersion: 1 };
  const target = { entityType: "feedstock" as const, entityId: input.entityId };
  const saved = { ...target, expectedVersion: 2, recordedDistanceKm: 55 };
  mocks.refresh.mockResolvedValue(success ? { success: true, data: saved } : { success: false, code: "stale_version", error: "Reload the record.", conflict: { entity: "feedstock", id: input.entityId, code: "stale-version" } });
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const keys = [feedstockKeys.list(), deliveryKeys.lists(), transportLegKeys.byEntity("feedstock", input.entityId)];
  for (const key of keys) client.setQueryData(key, []);
  const onSuccess = vi.fn();
  function Harness() {
    const mutation = useRefreshTransportDistance("feedstock", { onSuccess });
    return <button onClick={() => mutation.mutateAsync(input)}>Refresh</button>;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
  try {
    await act(async () => {
      const promise = renderer.root.findByType("button").props.onClick();
      if (success) await promise;
      else await expect(promise).rejects.toBeInstanceOf(StaleVersionError);
    });
    if (success) {
      expect(client.getQueryData(transportDistanceKeys.detail(target))).toEqual(saved);
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(onSuccess).toHaveBeenCalledWith(saved, input);
    } else expect(onSuccess).not.toHaveBeenCalled();
  } finally { act(() => renderer.unmount()); client.clear(); }
});
