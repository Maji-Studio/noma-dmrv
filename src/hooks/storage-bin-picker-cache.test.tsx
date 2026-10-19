// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useUpdateStorageLocation } from "./use-storage-locations";
import { useEntityById, useEntityOptions } from "./use-entities";
import { entityKeys } from "./entity-query-keys";

const state = vi.hoisted(() => ({ name: "Old bin" }));
vi.mock("@/fn/storage-locations", () => ({
  updateStorageLocationFn: async ({ name }: { name: string }) => {
    state.name = name;
    return { success: true, data: { id: "one", code: "1", name, facilityId: "facility", version: 2 } };
  },
}));
vi.mock("./use-output-stock", () => ({ outputStockKeys: { all: ["outputStock"] } }));
vi.mock("./use-facilities", () => ({ facilityKeys: { storageLocations: (id: string) => ["facilities", id, "storageLocations"] } }));
vi.mock("@/fn/entities", () => ({
  searchEntitiesFn: async () => ({ success: true, data: [{ id: "one", code: "1", name: state.name }] }),
  getEntityByIdFn: async () => ({ success: true, data: { id: "one", code: "1", name: state.name } }),
}));
afterEach(cleanup);
it("refreshes the selected label and filtered picker lists after a bin edit", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const old = { id: "one", code: "1", name: "Old bin" };
  const filterBy = { facilityId: "facility", type: "feedstock_bin" };
  client.setQueryData(entityKeys.detail("storageLocation", "one"), old);
  client.setQueryData(entityKeys.list("storageLocation", "", filterBy), [old]);
  const { result } = renderHook(() => ({
    selected: useEntityById("storageLocation", "one"),
    options: useEntityOptions({ entityType: "storageLocation", search: "", filterBy }),
    update: useUpdateStorageLocation(),
  }), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  expect(result.current.selected.data?.name).toBe("Old bin");
  await act(() => result.current.update.mutateAsync({ storageLocationId: "one", expectedVersion: 1, name: "Renamed bin" }));
  await waitFor(() => {
    expect(result.current.selected.data?.name).toBe("Renamed bin");
    expect(result.current.options.data?.[0].name).toBe("Renamed bin");
  });
  client.clear();
});
