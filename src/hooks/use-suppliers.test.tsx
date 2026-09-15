import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import { entityKeys } from "./entity-query-keys";
import { onboardingKeys } from "./use-onboarding";
import type {
  CreateSupplierData,
  CreateSupplierWithLocationsData,
} from "@/schemas/suppliers";

const mocks = vi.hoisted(() => ({
  createSupplierFn: vi.fn(),
  createSupplierWithLocationsFn: vi.fn(),
}));

vi.mock("@/fn/suppliers", () => ({
  createSupplierFn: mocks.createSupplierFn,
  createSupplierLocationFn: vi.fn(),
  createSupplierWithLocationsFn: mocks.createSupplierWithLocationsFn,
  deleteSupplierFn: vi.fn(),
  deleteSupplierLocationFn: vi.fn(),
  getSupplierByIdFn: vi.fn(),
  getSupplierLocationsBySupplierFn: vi.fn(),
  getSuppliersFn: vi.fn(),
  updateSupplierFn: vi.fn(),
  updateSupplierLocationFn: vi.fn(),
}));

import {
  useCreateSupplier,
  useCreateSupplierWithLocations,
} from "./use-suppliers";

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
  mocks.createSupplierFn.mockResolvedValue({
    success: true,
    data: createdSupplier,
  });
  mocks.createSupplierWithLocationsFn.mockResolvedValue({
    success: true,
    data: createdSupplier,
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

describe("supplier creation onboarding interaction", () => {
  it("completes and seeds the entity cache without starting an inactive onboarding refresh", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onboardingKey = onboardingKeys.status("facility-1", "org-1");
    let holdRefresh = false;
    let refreshStarted = false;
    const neverFinishes = new Promise<never>(() => undefined);

    await queryClient.fetchQuery({
      queryKey: onboardingKey,
      queryFn: async () => {
        if (holdRefresh) {
          refreshStarted = true;
          return neverFinishes;
        }
        return { supplierCount: 0 };
      },
      staleTime: Infinity,
    });
    holdRefresh = true;

    let capturedMutation: CreateMutation | undefined;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <TestProvider queryClient={queryClient}>
          <CreateSupplierHarness
            onCapture={(mutation) => {
              capturedMutation = mutation;
            }}
          />
        </TestProvider>,
      );
    });

    let created: unknown;
    await act(async () => {
      created = await capturedMutation?.mutateAsync({
        name: "New Supplier",
      } as CreateSupplierData);
    });

    expect(created).toEqual(createdSupplier);
    expect(refreshStarted).toBe(false);
    expect(queryClient.getQueryState(onboardingKey)?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryData(
        entityKeys.detail("supplier", createdSupplier.id),
      ),
    ).toEqual({ ...createdSupplier, subtitle: undefined });

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });

  it("completes while an active onboarding refresh is still pending", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onboardingKey = onboardingKeys.status("facility-1", "org-1");
    let holdRefresh = false;
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const queryFn = async () => {
      if (holdRefresh) await refreshGate;
      return { supplierCount: holdRefresh ? 1 : 0 };
    };
    await queryClient.fetchQuery({
      queryKey: onboardingKey,
      queryFn,
      staleTime: Infinity,
    });
    const onboardingObserver = new QueryObserver(queryClient, {
      queryKey: onboardingKey,
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribeOnboarding = onboardingObserver.subscribe(
      () => undefined,
    );
    holdRefresh = true;

    let capturedMutation: CreateMutation | undefined;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <TestProvider queryClient={queryClient}>
          <CreateSupplierHarness
            onCapture={(mutation) => {
              capturedMutation = mutation;
            }}
          />
        </TestProvider>,
      );
    });

    let created: unknown;
    await act(async () => {
      created = await capturedMutation?.mutateAsync({
        name: "New Supplier",
      } as CreateSupplierData);
    });

    expect(created).toEqual(createdSupplier);
    expect(onboardingObserver.getCurrentResult().isFetching).toBe(true);
    expect(capturedMutation?.isPending).toBe(false);

    releaseRefresh?.();
    await vi.waitFor(() => {
      expect(onboardingObserver.getCurrentResult().isFetching).toBe(false);
      expect(queryClient.getQueryData(onboardingKey)).toEqual({
        supplierCount: 1,
      });
    });

    unsubscribeOnboarding();
    await act(async () => renderer?.unmount());
    queryClient.clear();
  });

  it("does not invalidate onboarding or seed a supplier when persistence fails", async () => {
    mocks.createSupplierFn.mockResolvedValueOnce({
      success: false,
      error: "Supplier was not created",
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onboardingKey = onboardingKeys.status("facility-1", "org-1");
    queryClient.setQueryData(onboardingKey, { supplierCount: 0 });

    let capturedMutation: CreateMutation | undefined;
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(
        <TestProvider queryClient={queryClient}>
          <CreateSupplierHarness
            onCapture={(mutation) => {
              capturedMutation = mutation;
            }}
          />
        </TestProvider>,
      );
    });

    await act(async () => {
      await expect(
        capturedMutation?.mutateAsync({
          name: "New Supplier",
        } as CreateSupplierData),
      ).rejects.toThrow("Supplier was not created");
    });

    expect(queryClient.getQueryState(onboardingKey)?.isInvalidated).toBe(false);
    expect(
      queryClient.getQueryData(
        entityKeys.detail("supplier", createdSupplier.id),
      ),
    ).toBeUndefined();

    await act(async () => renderer?.unmount());
    queryClient.clear();
  });
});
