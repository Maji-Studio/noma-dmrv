// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useUpdateFormulation, formulationKeys } from "./use-formulations";
import { useUpdateFeedstockType, feedstockTypeKeys } from "./use-feedstock-types";
import { useEntityById, useEntityOptions } from "./use-entities";
import { entityKeys } from "./entity-query-keys";

const state = vi.hoisted(() => ({ name: "Old name" }));
const save = async ({ name }: { name?: string }) => {
  state.name = name!;
  return { success: true, data: { id: "one", code: "1", name, version: 2 } };
};
vi.mock("@/fn/formulations", () => ({ updateFormulationFn: (data: { name: string }) => save(data) }));
vi.mock("@/fn/feedstock-types", () => ({ updateFeedstockTypeFn: (data: { name: string }) => save(data) }));
vi.mock("@/fn/entities", () => ({
  searchEntitiesFn: async () => ({ success: true, data: [{ id: "one", code: "1", name: state.name }] }),
  getEntityByIdFn: async () => ({ success: true, data: { id: "one", code: "1", name: state.name } }),
}));
afterEach(cleanup);
it.each(["formulation", "feedstockType"] as const)("refreshes selected %s labels, lists and record caches after edit", async (entityType) => {
  state.name = "Old name";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const old = { id: "one", code: "1", name: state.name };
  const filterBy = { usage: "blend" };
  client.setQueryData(entityKeys.detail(entityType, "one"), old);
  client.setQueryData(entityKeys.list(entityType, "", filterBy), [old]);
  const recordKey = entityType === "formulation" ? formulationKeys.detail("one") : feedstockTypeKeys.detail("one");
  client.setQueryData(recordKey, old);
  const { result } = renderHook(() => ({
    selected: useEntityById(entityType, "one"),
    options: useEntityOptions({ entityType, search: "", filterBy }),
    formulation: useUpdateFormulation(), feedstockType: useUpdateFeedstockType(),
  }), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  expect(result.current.selected.data?.name).toBe("Old name");
  await act(async () => {
    if (entityType === "formulation") await result.current.formulation.mutateAsync({ formulationId: "one", expectedVersion: 1, name: "Renamed" });
    else await result.current.feedstockType.mutateAsync({ feedstockTypeId: "one", expectedVersion: 1, name: "Renamed" });
  });
  await waitFor(() => {
    expect(result.current.selected.data?.name).toBe("Renamed");
    expect(result.current.options.data?.[0].name).toBe("Renamed");
  });
  expect(client.getQueryState(recordKey)?.isInvalidated || client.getQueryData<{ name: string }>(recordKey)?.name === "Renamed").toBe(true);
  client.clear();
});
