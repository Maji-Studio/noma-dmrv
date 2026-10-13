import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import { entityKeys } from "./entity-query-keys";
import { customerKeys } from "./customer-query-keys";
import type {
  CreateCustomerWithLocationsData,
  UpdateCustomerData,
  CreateCustomerLocationData,
  UpdateCustomerLocationData,
} from "@/schemas/customers";
import type { Customer, CustomerLocation } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  createCustomerWithLocationsFn: vi.fn(),
  updateCustomerFn: vi.fn(),
  deleteCustomerFn: vi.fn(),
  createCustomerLocationFn: vi.fn(),
  updateCustomerLocationFn: vi.fn(),
  deleteCustomerLocationFn: vi.fn(),
}));

vi.mock("@/fn/customers", () => ({
  createCustomerWithLocationsFn: mocks.createCustomerWithLocationsFn,
  updateCustomerFn: mocks.updateCustomerFn,
  deleteCustomerFn: mocks.deleteCustomerFn,
  getCustomersFn: vi.fn(),
  getCustomerWithRelationsFn: vi.fn(),
  getCustomerLocationsFn: vi.fn(),
  createCustomerLocationFn: mocks.createCustomerLocationFn,
  updateCustomerLocationFn: mocks.updateCustomerLocationFn,
  deleteCustomerLocationFn: mocks.deleteCustomerLocationFn,
}));

import {
  useCreateCustomerWithLocations,
  useCreateCustomerLocation,
  useUpdateCustomerLocation,
  useDeleteCustomerLocation,
  useDeleteCustomer,
  useUpdateCustomer,
} from "./use-customers";

const customer = {
  id: "customer-1",
  code: "CUS-001",
  name: "New Customer",
  cropType: "Maize",
} as Customer;

const location = { id: "location-1", customerId: customer.id, name: "North field" } as CustomerLocation;

type CreateMutation = ReturnType<typeof useCreateCustomerWithLocations>;
type UpdateMutation = ReturnType<typeof useUpdateCustomer>;
type DeleteMutation = ReturnType<typeof useDeleteCustomer>;
type CreateLocationMutation = ReturnType<typeof useCreateCustomerLocation>;
type UpdateLocationMutation = ReturnType<typeof useUpdateCustomerLocation>;
type DeleteLocationMutation = ReturnType<typeof useDeleteCustomerLocation>;
type AnyMutation = CreateMutation | UpdateMutation | DeleteMutation | CreateLocationMutation | UpdateLocationMutation | DeleteLocationMutation;

function Harness({
  useMutationHook,
  onCapture,
}: {
  useMutationHook: () => AnyMutation;
  onCapture: (mutation: AnyMutation) => void;
}) {
  const mutation = useMutationHook();
  useEffect(() => onCapture(mutation), [mutation, onCapture]);
  return null;
}

function TestProvider({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

async function renderMutation(
  queryClient: QueryClient,
  useMutationHook: () => AnyMutation,
) {
  let captured: AnyMutation | undefined;
  let renderer: ReactTestRenderer | undefined;

  await act(async () => {
    renderer = create(
      <TestProvider queryClient={queryClient}>
        <Harness
          useMutationHook={useMutationHook}
          onCapture={(mutation) => {
            captured = mutation;
          }}
        />
      </TestProvider>,
    );
  });

  return { mutation: captured, renderer };
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createCustomerLocationFn.mockResolvedValue({ success: true, data: location });
  mocks.updateCustomerLocationFn.mockResolvedValue({ success: true, data: location });
  mocks.deleteCustomerLocationFn.mockResolvedValue({ success: true });
  mocks.createCustomerWithLocationsFn.mockReset();
  mocks.updateCustomerFn.mockReset();
  mocks.deleteCustomerFn.mockReset();
  mocks.createCustomerWithLocationsFn.mockResolvedValue({
    success: true,
    data: { customer, locations: [location] },
  });
  mocks.updateCustomerFn.mockResolvedValue({ success: true, data: customer });
  mocks.deleteCustomerFn.mockResolvedValue({ success: true, data: undefined });
});

describe("customer mutations keep the EntitySelect caches fresh", () => {
  it("seeds the customer detail and entity caches after creation with locations", async () => {
    const queryClient = newQueryClient();
    const listKey = entityKeys.list("customer");
    queryClient.setQueryData(listKey, []);
    const locationListKey = entityKeys.list("customerLocation", "", { customerId: customer.id });
    queryClient.setQueryData(locationListKey, []);

    const { mutation, renderer } = await renderMutation(
      queryClient,
      useCreateCustomerWithLocations,
    );

    await act(async () => {
      await (mutation as CreateMutation).mutateAsync({
        customer: { name: "New Customer" },
        locations: [],
      } as CreateCustomerWithLocationsData);
    });

    expect(queryClient.getQueryData(customerKeys.detail(customer.id))).toEqual(
      customer,
    );
    expect(
      queryClient.getQueryData(entityKeys.detail("customer", customer.id)),
    ).toEqual({
      id: customer.id,
      code: customer.code,
      name: customer.name,
      subtitle: customer.cropType,
    });
    expect(queryClient.getQueryState(locationListKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });

  it("invalidates the entity caches after an update", async () => {
    const queryClient = newQueryClient();
    const listKey = entityKeys.list("customer");
    const detailKey = entityKeys.detail("customer", customer.id);
    queryClient.setQueryData(listKey, []);
    queryClient.setQueryData(detailKey, { ...customer, subtitle: "Stale" });

    const { mutation, renderer } = await renderMutation(
      queryClient,
      useUpdateCustomer,
    );

    await act(async () => {
      await (mutation as UpdateMutation).mutateAsync({
        customerId: customer.id,
        name: "Renamed Customer",
      } as UpdateCustomerData);
    });

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });

  it("drops the deleted customer from the entity caches", async () => {
    const queryClient = newQueryClient();
    const listKey = entityKeys.list("customer");
    const detailKey = entityKeys.detail("customer", customer.id);
    queryClient.setQueryData(listKey, []);
    queryClient.setQueryData(detailKey, customer);

    const { mutation, renderer } = await renderMutation(
      queryClient,
      useDeleteCustomer,
    );

    await act(async () => {
      await (mutation as DeleteMutation).mutateAsync({ customerId: customer.id, expectedVersion: 1 });
    });

    expect(queryClient.getQueryData(detailKey)).toBeUndefined();
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });
});


describe("customer location mutations refresh the new picker", () => {
  it.each(["create", "update"] as const)("invalidates location search and details after %s", async (operation) => {
    const queryClient = newQueryClient();
    const listKey = entityKeys.list("customerLocation", "North", { customerId: customer.id });
    const detailKey = entityKeys.detail("customerLocation", location.id);
    queryClient.setQueryData(listKey, [location]);
    queryClient.setQueryData(customerKeys.locations(customer.id), [{ ...location, name: "Old name" }]);
    queryClient.setQueryData(detailKey, { ...location, name: "Old name" });
    const { mutation, renderer } = await renderMutation(queryClient, operation === "create" ? useCreateCustomerLocation : useUpdateCustomerLocation);
    await act(async () => {
      if (operation === "create") {
        await (mutation as CreateLocationMutation).mutateAsync({ customerId: customer.id, name: location.name } as CreateCustomerLocationData);
      } else {
        await (mutation as UpdateLocationMutation).mutateAsync({ locationId: location.id, name: location.name, expectedVersion: 1 } as UpdateCustomerLocationData);
      }
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(customerKeys.locations(customer.id))?.isInvalidated).toBe(true);
    if (operation === "update") {
      expect(queryClient.getQueryData(customerKeys.locations(customer.id))).toEqual([location]);
    }
    await act(async () => renderer?.unmount());
    queryClient.clear();
  });

  it("drops deleted locations from the detail cache and refreshes search", async () => {
    const queryClient = newQueryClient();
    const listKey = entityKeys.list("customerLocation", "", { customerId: customer.id });
    const detailKey = entityKeys.detail("customerLocation", location.id);
    queryClient.setQueryData(listKey, [location]);
    queryClient.setQueryData(detailKey, location);
    const { mutation, renderer } = await renderMutation(queryClient, () => useDeleteCustomerLocation(customer.id));
    await act(async () => {
      await (mutation as DeleteLocationMutation).mutateAsync({ locationId: location.id, expectedVersion: 1 });
    });
    expect(queryClient.getQueryData(detailKey)).toBeUndefined();
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    await act(async () => renderer?.unmount());
    queryClient.clear();
  });
});
