import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import { entityKeys } from "./entity-query-keys";
import type {
  CreateSupplierData,
  CreateSupplierWithLocationsData,
} from "@/schemas/suppliers";
import type { Supplier, SupplierLocation } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  createSupplierFn: vi.fn(),
  createSupplierWithLocationsFn: vi.fn(),
  getSupplierByIdFn: vi.fn(),
  getSupplierLocationsBySupplierFn: vi.fn(),
}));

vi.mock("@/fn/suppliers", () => ({
  createSupplierFn: mocks.createSupplierFn,
  createSupplierLocationFn: vi.fn(),
  createSupplierWithLocationsFn: mocks.createSupplierWithLocationsFn,
  deleteSupplierFn: vi.fn(),
  deleteSupplierLocationFn: vi.fn(),
  getSupplierByIdFn: mocks.getSupplierByIdFn,
  getSupplierLocationsBySupplierFn: mocks.getSupplierLocationsBySupplierFn,
  getSuppliersFn: vi.fn(),
  updateSupplierFn: vi.fn(),
  updateSupplierLocationFn: vi.fn(),
}));

vi.mock("./use-onboarding", () => ({
  invalidateOnboardingProgress: vi.fn(),
}));

import {
  useCreateSupplier,
  useCreateSupplierWithLocations,
  useSupplier,
  useSupplierLocationsBySupplier,
} from "./use-suppliers";
import { supplierKeys } from "./supplier-query-keys";

const createdSupplier = {
  id: "supplier-2",
  code: "SUP-002",
  name: "New Supplier",
};

type CreateMutation = ReturnType<typeof useCreateSupplier>;
type CreateWithLocationsMutation = ReturnType<
  typeof useCreateSupplierWithLocations
>;

function CreateSupplierHarness({
  onCapture,
}: {
  onCapture: (mutation: CreateMutation) => void;
}) {
  const mutation = useCreateSupplier();
  useEffect(() => onCapture(mutation), [mutation, onCapture]);
  return null;
}

function CreateSupplierWithLocationsHarness({
  onCapture,
}: {
  onCapture: (mutation: CreateWithLocationsMutation) => void;
}) {
  const mutation = useCreateSupplierWithLocations();
  useEffect(() => onCapture(mutation), [mutation, onCapture]);
  return null;
}

function SupplierDetailQueryHarness({
  supplierId,
  onCapture,
}: {
  supplierId: string;
  onCapture: (data: {
    supplier: Supplier | undefined;
    locations: SupplierLocation[] | undefined;
  }) => void;
}) {
  const supplier = useSupplier(supplierId);
  const locations = useSupplierLocationsBySupplier(supplierId);
  useEffect(
    () => onCapture({ supplier: supplier.data, locations: locations.data }),
    [supplier.data, locations.data, onCapture],
  );
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

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.createSupplierFn.mockReset();
  mocks.createSupplierWithLocationsFn.mockReset();
  mocks.getSupplierByIdFn.mockReset();
  mocks.getSupplierLocationsBySupplierFn.mockReset();
  mocks.createSupplierFn.mockResolvedValue({
    success: true,
    data: createdSupplier,
  });
  mocks.createSupplierWithLocationsFn.mockResolvedValue({
    success: true,
    data: createdSupplier,
  });
});

describe("supplier detail hydration", () => {
  const firstSupplier = {
    id: "supplier-1",
    code: "SUP-001",
    name: "First Supplier",
  } as Supplier;
  const secondSupplier = {
    id: "supplier-2",
    code: "SUP-002",
    name: "Second Supplier",
  } as Supplier;
  const firstLocations = [
    { id: "location-1", supplierId: firstSupplier.id, country: "Switzerland" },
  ] as SupplierLocation[];

  function hydrationState(
    supplier: Supplier,
    locations: SupplierLocation[],
  ) {
    const serverClient = new QueryClient();
    const updatedAt = Date.now();
    serverClient.setQueryData(supplierKeys.detail(supplier.id), supplier, {
      updatedAt,
    });
    serverClient.setQueryData(
      supplierKeys.supplierLocations(supplier.id),
      locations,
      { updatedAt },
    );
    return dehydrate(serverClient);
  }

  it("uses hydrated complete data without duplicate initial actions", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let captured:
      | { supplier: Supplier | undefined; locations: SupplierLocation[] | undefined }
      | undefined;
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <TestProvider queryClient={queryClient}>
          <HydrationBoundary state={hydrationState(firstSupplier, firstLocations)}>
            <SupplierDetailQueryHarness
              supplierId={firstSupplier.id}
              onCapture={(data) => {
                captured = data;
              }}
            />
          </HydrationBoundary>
        </TestProvider>,
      );
    });

    expect(captured).toEqual({
      supplier: firstSupplier,
      locations: firstLocations,
    });
    expect(mocks.getSupplierByIdFn).not.toHaveBeenCalled();
    expect(mocks.getSupplierLocationsBySupplierFn).not.toHaveBeenCalled();

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });

  it("hydrates a client navigation under the destination ID only", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let captured: Supplier | undefined;
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <TestProvider queryClient={queryClient}>
          <HydrationBoundary state={hydrationState(secondSupplier, [])}>
            <SupplierDetailQueryHarness
              supplierId={secondSupplier.id}
              onCapture={(data) => {
                captured = data.supplier;
              }}
            />
          </HydrationBoundary>
        </TestProvider>,
      );
    });

    expect(captured).toBe(secondSupplier);
    expect(queryClient.getQueryData(supplierKeys.detail(firstSupplier.id))).toBeUndefined();
    expect(queryClient.getQueryData(supplierKeys.detail(secondSupplier.id))).toBe(secondSupplier);
    expect(mocks.getSupplierByIdFn).not.toHaveBeenCalled();

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });
});

describe.each([
  ["useCreateSupplier", false],
  ["useCreateSupplierWithLocations", true],
] as const)("%s EntitySelect cache behavior", (_name, withLocations) => {
  it("seeds supplier detail and invalidates supplier lists after creation", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const listKey = entityKeys.list("supplier");
    queryClient.setQueryData(listKey, []);
    let capturedMutation:
      | CreateMutation
      | CreateWithLocationsMutation
      | undefined;
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(
        <TestProvider queryClient={queryClient}>
          {withLocations ? (
            <CreateSupplierWithLocationsHarness
              onCapture={(mutation) => {
                capturedMutation = mutation;
              }}
            />
          ) : (
            <CreateSupplierHarness
              onCapture={(mutation) => {
                capturedMutation = mutation;
              }}
            />
          )}
        </TestProvider>,
      );
    });

    expect(capturedMutation).toBeDefined();
    await act(async () => {
      if (withLocations) {
        await (capturedMutation as CreateWithLocationsMutation).mutateAsync({
          supplier: { name: "New Supplier" },
          locations: [
            {
              country: "Switzerland",
              gpsLatitude: 47,
              gpsLongitude: 8,
              isDefault: true,
            },
          ],
        } as CreateSupplierWithLocationsData);
      } else {
        await (capturedMutation as CreateMutation).mutateAsync({
          name: "New Supplier",
        } as CreateSupplierData);
      }
    });

    expect(
      queryClient.getQueryData(
        entityKeys.detail("supplier", createdSupplier.id),
      ),
    ).toEqual({ ...createdSupplier, subtitle: undefined });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });
});
