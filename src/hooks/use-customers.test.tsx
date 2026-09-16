import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import { entityKeys } from "./entity-query-keys";
import type { CreateCustomerData, UpdateCustomerData } from "@/schemas/customers";
import type { Customer } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  createCustomerFn: vi.fn(),
  updateCustomerFn: vi.fn(),
  deleteCustomerFn: vi.fn(),
}));

vi.mock("@/fn/customers", () => ({
  createCustomerFn: mocks.createCustomerFn,
  updateCustomerFn: mocks.updateCustomerFn,
  deleteCustomerFn: mocks.deleteCustomerFn,
  getCustomersFn: vi.fn(),
  getCustomerWithRelationsFn: vi.fn(),
  getCustomerLocationsFn: vi.fn(),
  createCustomerLocationFn: vi.fn(),
  updateCustomerLocationFn: vi.fn(),
  deleteCustomerLocationFn: vi.fn(),
}));

import {
  useCreateCustomer,
  useDeleteCustomer,
  useUpdateCustomer,
} from "./use-customers";

const customer = {
  id: "customer-1",
  code: "CUS-001",
  name: "New Customer",
  cropType: "Maize",
} as Customer;

type CreateMutation = ReturnType<typeof useCreateCustomer>;
type UpdateMutation = ReturnType<typeof useUpdateCustomer>;
type DeleteMutation = ReturnType<typeof useDeleteCustomer>;
type AnyMutation = CreateMutation | UpdateMutation | DeleteMutation;

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
  mocks.createCustomerFn.mockReset();
  mocks.updateCustomerFn.mockReset();
  mocks.deleteCustomerFn.mockReset();
  mocks.createCustomerFn.mockResolvedValue({ success: true, data: customer });
  mocks.updateCustomerFn.mockResolvedValue({ success: true, data: customer });
  mocks.deleteCustomerFn.mockResolvedValue({ success: true, data: undefined });
});

describe("customer mutations keep the EntitySelect caches fresh", () => {
  it("seeds the entity caches after creation", async () => {
    const queryClient = newQueryClient();
    const listKey = entityKeys.list("customer");
    queryClient.setQueryData(listKey, []);

    const { mutation, renderer } = await renderMutation(
      queryClient,
      useCreateCustomer,
    );

    await act(async () => {
      await (mutation as CreateMutation).mutateAsync({
        name: "New Customer",
      } as CreateCustomerData);
    });

    expect(
      queryClient.getQueryData(entityKeys.detail("customer", customer.id)),
    ).toEqual({
      id: customer.id,
      code: customer.code,
      name: customer.name,
      subtitle: customer.cropType,
    });
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
      await (mutation as DeleteMutation).mutateAsync(customer.id);
    });

    expect(queryClient.getQueryData(detailKey)).toBeUndefined();
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });
});
