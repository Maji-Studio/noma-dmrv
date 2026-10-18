import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { chainOfCustodyKeys } from "./use-chain-of-custody";
import { useUpdateApplication } from "./use-applications";
import { useUpdateCustomerLocation } from "./use-customers";
import { useUpdateFacility } from "./use-facilities";
import { useCreateSupplierLocation, useUpdateSupplierLocation } from "./use-suppliers";
import { useCreateTransportLeg, useDeleteTransportLeg, useUpdateTransportLeg } from "./use-transport-legs";

const ID = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("@/fn/applications", () => ({ updateApplicationFn: mocks.write }));
vi.mock("@/fn/customers", () => ({ updateCustomerLocationFn: mocks.write }));
vi.mock("@/fn/facilities", () => ({ updateFacilityFn: mocks.write }));
vi.mock("@/fn/suppliers", () => ({
  createSupplierLocationFn: mocks.write,
  updateSupplierLocationFn: mocks.write,
}));
vi.mock("@/fn/transport-legs", () => ({
  createTransportLegFn: mocks.write,
  updateTransportLegFn: mocks.write,
  deleteTransportLegFn: mocks.write,
}));

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  mocks.write.mockResolvedValue({ success: true, data: { id: ID, customerId: ID } });
});

const writes = {
  application: useUpdateApplication,
  "customer location": useUpdateCustomerLocation,
  facility: function useFacilityWrite() { return useUpdateFacility(undefined, { optimistic: false }); },
  "supplier location create": useCreateSupplierLocation,
  "supplier location update": function useSupplierWrite() { return useUpdateSupplierLocation(ID); },
  "transport leg create": useCreateTransportLeg,
  "transport leg update": function useLegUpdate() { return useUpdateTransportLeg("feedstock", ID); },
  "transport leg delete": function useLegDelete() { return useDeleteTransportLeg("feedstock", ID); },
} as const;

it.each(Object.keys(writes) as (keyof typeof writes)[])(
  "%s changes refresh fresh application and credit-batch CoC caches only after success",
  async (write) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const keys = [
      chainOfCustodyKeys.detail(ID), chainOfCustodyKeys.geo(ID), chainOfCustodyKeys.trail(ID),
      chainOfCustodyKeys.batch("batch"), chainOfCustodyKeys.batchGeo("batch"),
      chainOfCustodyKeys.batchGeo("batch", "run"),
    ];
    for (const key of keys) client.setQueryData(key, {});
    const unrelatedKey = ["unrelated"];
    client.setQueryData(unrelatedKey, {});
    const useWrite = writes[write] as () => { mutateAsync: (input: unknown) => Promise<unknown> };
    const input = {
      applicationId: ID, locationId: ID, facilityId: ID, supplierId: ID,
      entityType: "feedstock", entityId: ID, legId: ID, expectedVersion: 1,
    };
    function Harness() {
      const mutation = useWrite();
      return <button onClick={() => mutation.mutateAsync(input)}>Save</button>;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
    });
    try {
      mocks.write.mockResolvedValueOnce({ success: false, error: "Save refused" });
      await act(async () => {
        await expect(renderer.root.findByType("button").props.onClick()).rejects.toThrow("Save refused");
      });
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      await act(async () => { await renderer.root.findByType("button").props.onClick(); });
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
    } finally {
      act(() => renderer.unmount());
      client.clear();
    }
  },
);
