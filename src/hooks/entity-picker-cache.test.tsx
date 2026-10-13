// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useUpdateFormulation, formulationKeys } from "./use-formulations";
import { useUpdateFeedstockType, feedstockTypeKeys } from "./use-feedstock-types";
import { useEntityById, useEntityOptions } from "./use-entities";
import { entityKeys } from "./entity-query-keys";
import { useUpdateCustomer } from "./use-customers";

const state = vi.hoisted(() => ({ name: "Old name", customer: "Customer", formulation: "Formulation" }));
const save = async ({ name }: { name?: string }) => {
  state.name = name!;
  return { success: true, data: { id: "one", code: "1", name, version: 2 } };
};
vi.mock("@/fn/formulations", () => ({ updateFormulationFn: (data: { name: string }) => {
  state.formulation = data.name;
  return save(data);
} }));
vi.mock("@/fn/customers", () => ({ updateCustomerFn: (data: { name: string }) => {
  state.customer = data.name;
  return save(data);
} }));
vi.mock("@/fn/feedstock-types", () => ({ updateFeedstockTypeFn: (data: { name: string }) => save(data) }));
vi.mock("@/fn/entities", () => ({
  searchEntitiesFn: async ({ entityType }: { entityType: string }) => ({ success: true, data: [{ id: "one", code: "1", name: entityType === "order" ? `${state.customer} · ${state.formulation}` : state.name }] }),
  getEntityByIdFn: async (entityType: string) => ({ success: true, data: { id: "one", code: "1", name: entityType === "order" ? `${state.customer} · ${state.formulation}` : state.name } }),
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

it.each(["customer", "formulation"] as const)("refreshes order picker labels after renaming its %s", async (entityType) => {
  state.customer = "Customer";
  state.formulation = "Formulation";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const old = { id: "one", code: "1", name: "Customer · Formulation" };
  const filterBy = { facilityId: "facility-one" };
  client.setQueryData(entityKeys.detail("order", "one"), old);
  client.setQueryData(entityKeys.list("order", "", filterBy), [old]);
  const { result } = renderHook(() => ({
    selected: useEntityById("order", "one"),
    options: useEntityOptions({ entityType: "order", search: "", filterBy }),
    customer: useUpdateCustomer(),
    formulation: useUpdateFormulation(),
  }), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });

  expect(result.current.selected.data?.name).toBe("Customer · Formulation");
  expect(result.current.options.data?.[0].name).toBe("Customer · Formulation");
  await act(async () => {
    if (entityType === "customer") await result.current.customer.mutateAsync({ customerId: "one", expectedVersion: 1, name: "Renamed customer" });
    else await result.current.formulation.mutateAsync({ formulationId: "one", expectedVersion: 1, name: "Renamed formulation" });
  });
  const expectedLabel = entityType === "customer" ? "Renamed customer · Formulation" : "Customer · Renamed formulation";
  await waitFor(() => {
    expect(result.current.selected.data?.name).toBe(expectedLabel);
    expect(result.current.options.data?.[0].name).toBe(expectedLabel);
  });
  client.clear();
});
