import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import type { CustomerDetail } from "@/data-access/customers";
import type { UpdateCustomerData } from "@/schemas/customers";

const mocks = vi.hoisted(() => ({
  getCustomerWithRelationsFn: vi.fn(),
  updateCustomerFn: vi.fn(),
}));

vi.mock("@/fn/customers", () => ({
  createCustomerFn: vi.fn(),
  createCustomerLocationFn: vi.fn(),
  deleteCustomerFn: vi.fn(),
  deleteCustomerLocationFn: vi.fn(),
  getCustomerLocationsFn: vi.fn(),
  getCustomersFn: vi.fn(),
  getCustomerWithRelationsFn: mocks.getCustomerWithRelationsFn,
  updateCustomerFn: mocks.updateCustomerFn,
  updateCustomerLocationFn: vi.fn(),
}));

import { customerKeys } from "./customer-query-keys";
import {
  useCustomerWithRelations,
  useUpdateCustomer,
} from "./use-customers";

const INITIAL_CUSTOMER = {
  id: "customer-1",
  code: "CUS-001",
  name: "Initial Customer",
  locations: [{ id: "location-1", country: "Switzerland" }],
} as CustomerDetail;

const UPDATED_CUSTOMER = {
  ...INITIAL_CUSTOMER,
  name: "Updated Customer",
} as CustomerDetail;

type UpdateMutation = ReturnType<typeof useUpdateCustomer>;

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

function CustomerDetailQueryHarness({
  customerId,
  onCapture,
}: {
  customerId: string;
  onCapture: (detail: CustomerDetail | undefined) => void;
}) {
  const detail = useCustomerWithRelations(customerId);
  useEffect(() => onCapture(detail.data), [detail.data, onCapture]);
  return null;
}

function CustomerUpdateHarness({
  customerId,
  onDetail,
  onMutation,
}: {
  customerId: string;
  onDetail: (detail: CustomerDetail | undefined) => void;
  onMutation: (mutation: UpdateMutation) => void;
}) {
  const detail = useCustomerWithRelations(customerId);
  const mutation = useUpdateCustomer();
  useEffect(() => onDetail(detail.data), [detail.data, onDetail]);
  useEffect(() => onMutation(mutation), [mutation, onMutation]);
  return null;
}

function hydrationState(customer: CustomerDetail) {
  const serverClient = new QueryClient();
  serverClient.setQueryData(
    customerKeys.detailWithRelations(customer.id),
    customer,
    { updatedAt: Date.now() },
  );
  return dehydrate(serverClient);
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.getCustomerWithRelationsFn.mockReset();
  mocks.updateCustomerFn.mockReset();
});

describe("customer detail hydration", () => {
  it("uses hydrated relations without a duplicate initial action", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let captured: CustomerDetail | undefined;
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <TestProvider queryClient={queryClient}>
          <HydrationBoundary state={hydrationState(INITIAL_CUSTOMER)}>
            <CustomerDetailQueryHarness
              customerId={INITIAL_CUSTOMER.id}
              onCapture={(detail) => {
                captured = detail;
              }}
            />
          </HydrationBoundary>
        </TestProvider>,
      );
    });

    expect(captured).toBe(INITIAL_CUSTOMER);
    expect(mocks.getCustomerWithRelationsFn).not.toHaveBeenCalled();

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });

  it("refreshes hydrated detail after an edit succeeds", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    mocks.updateCustomerFn.mockResolvedValue({
      success: true,
      data: { ...UPDATED_CUSTOMER, locations: undefined },
    });
    mocks.getCustomerWithRelationsFn.mockResolvedValue({
      success: true,
      data: UPDATED_CUSTOMER,
    });
    let captured: CustomerDetail | undefined;
    let mutation: UpdateMutation | undefined;
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <TestProvider queryClient={queryClient}>
          <HydrationBoundary state={hydrationState(INITIAL_CUSTOMER)}>
            <CustomerUpdateHarness
              customerId={INITIAL_CUSTOMER.id}
              onDetail={(detail) => {
                captured = detail;
              }}
              onMutation={(value) => {
                mutation = value;
              }}
            />
          </HydrationBoundary>
        </TestProvider>,
      );
    });

    await act(async () => {
      await mutation?.mutateAsync({
        customerId: INITIAL_CUSTOMER.id,
        name: UPDATED_CUSTOMER.name,
      } as UpdateCustomerData);
      await vi.waitFor(() => {
        expect(
          queryClient.getQueryData(
            customerKeys.detailWithRelations(INITIAL_CUSTOMER.id),
          ),
        ).toEqual(UPDATED_CUSTOMER);
      });
    });

    expect(mocks.getCustomerWithRelationsFn).toHaveBeenCalledTimes(1);
    expect(captured?.name).toBe(UPDATED_CUSTOMER.name);

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });
});
