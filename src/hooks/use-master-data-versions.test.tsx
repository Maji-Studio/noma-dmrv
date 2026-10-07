import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";
const mocks = vi.hoisted(() => ({ update: vi.fn(), remove: vi.fn() }));
vi.mock("@/fn/facilities", () => ({ updateFacilityFn: mocks.update, archiveFacilityFn: mocks.remove }));
vi.mock("@/fn/reactors", () => ({ updateReactorFn: mocks.update, deleteReactorFn: mocks.remove }));
vi.mock("@/fn/storage-locations", () => ({ updateStorageLocationFn: mocks.update, deleteStorageLocationFn: mocks.remove }));
vi.mock("@/fn/suppliers", () => ({ updateSupplierFn: mocks.update, updateSupplierLocationFn: mocks.update, deleteSupplierFn: mocks.remove, deleteSupplierLocationFn: mocks.remove }));
vi.mock("@/fn/customers", () => ({ updateCustomerFn: mocks.update, updateCustomerLocationFn: mocks.update, deleteCustomerFn: mocks.remove, deleteCustomerLocationFn: mocks.remove }));
vi.mock("@/fn/formulations", () => ({ updateFormulationFn: mocks.update, deleteFormulationFn: mocks.remove }));
vi.mock("@/fn/feedstock-types", () => ({ updateFeedstockTypeFn: mocks.update, deleteFeedstockTypeFn: mocks.remove }));
import { useUpdateFacility, useArchiveFacility } from "./use-facilities";
import { useUpdateReactor, useDeleteReactor } from "./use-reactors";
import { storageLocationKeys, useUpdateStorageLocation, useDeleteStorageLocation } from "./use-storage-locations";
import { useUpdateSupplier, useDeleteSupplier, useUpdateSupplierLocation, useDeleteSupplierLocation } from "./use-suppliers";
import { useUpdateCustomer, useDeleteCustomer, useUpdateCustomerLocation, useDeleteCustomerLocation } from "./use-customers";
import { useUpdateFormulation, useDeleteFormulation } from "./use-formulations";
import { useUpdateFeedstockType, useDeleteFeedstockType } from "./use-feedstock-types";
const ID = "33333333-3333-4333-8333-333333333333";
const VERSION = 3;
const failure = { success: false, error: STALE_VERSION_MESSAGE, code: "stale_version", conflict: { entity: "facility", id: ID, code: STALE_VERSION_CONFLICT_CODE } };
beforeEach(() => { mocks.update.mockReset().mockResolvedValue(failure); mocks.remove.mockReset().mockResolvedValue(failure); });

const cases = [
  { name: "facility", useWrites: () => ({ update: useUpdateFacility(), remove: useArchiveFacility() }), input: { facilityId: ID, expectedVersion: VERSION }, key: ["facilities", "list"] },
  { name: "reactor", useWrites: () => ({ update: useUpdateReactor(), remove: useDeleteReactor() }), input: { reactorId: ID, expectedVersion: VERSION }, key: ["reactors", "list"] },
  { name: "bin", useWrites: () => ({ update: useUpdateStorageLocation(), remove: useDeleteStorageLocation() }), input: { storageLocationId: ID, expectedVersion: VERSION }, key: [...storageLocationKeys.all, "list"] },
  { name: "supplier", useWrites: () => ({ update: useUpdateSupplier(), remove: useDeleteSupplier() }), input: { supplierId: ID, expectedVersion: VERSION }, key: ["suppliers", "list"] },
  { name: "supplier location", useWrites: () => ({ update: useUpdateSupplierLocation(ID), remove: useDeleteSupplierLocation(ID) }), input: { locationId: ID, expectedVersion: VERSION }, key: ["suppliers", "list"] },
  { name: "customer", useWrites: () => ({ update: useUpdateCustomer(), remove: useDeleteCustomer() }), input: { customerId: ID, expectedVersion: VERSION }, key: ["customers", "list"] },
  { name: "customer location", useWrites: () => ({ update: useUpdateCustomerLocation(), remove: useDeleteCustomerLocation(ID) }), input: { locationId: ID, expectedVersion: VERSION }, key: ["customers", "list"] },
  { name: "formulation", useWrites: () => ({ update: useUpdateFormulation(), remove: useDeleteFormulation() }), input: { formulationId: ID, expectedVersion: VERSION }, key: ["formulations", "list"] },
  { name: "feedstock type", useWrites: () => ({ update: useUpdateFeedstockType(), remove: useDeleteFeedstockType() }), input: { feedstockTypeId: ID, expectedVersion: VERSION }, key: ["feedstock-types", "list"] },
];

describe.each(cases)("$name mutations", ({ useWrites, input, key }) => {
  it("forwards the loaded version, preserves stale errors, and refreshes refused deletes", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(key, { items: [{ id: ID, version: VERSION }] });
    function Harness() {
      const writes = useWrites();
      // Each case binds its entity's payload to its own pair of hooks.
      const invoke = (kind: "update" | "remove") => (writes[kind].mutateAsync as (value: typeof input) => Promise<unknown>)(input);
      return <><button onClick={() => invoke("update")}>Save</button><button onClick={() => invoke("remove")}>Delete</button></>;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
    try {
      for (const button of renderer.root.findAllByType("button")) {
        await act(async () => { await expect(button.props.onClick()).rejects.toBeInstanceOf(StaleVersionError); });
      }
      expect(mocks.update).toHaveBeenCalledWith(input);
      expect(mocks.remove).toHaveBeenCalledWith(input);
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    } finally { act(() => renderer.unmount()); client.clear(); }
  });
});
