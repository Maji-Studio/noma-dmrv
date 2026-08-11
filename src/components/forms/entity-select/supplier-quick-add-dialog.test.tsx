import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { PendingSupplierLocation } from "@/components/suppliers/supplier-form";
import type { SupplierFormData } from "@/schemas/suppliers";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  shellProps: undefined as
    | {
        children: ReactNode;
        dismissible?: boolean;
        dismissOnClickOutside?: boolean;
        onOpen?: () => void;
      }
    | undefined,
  mutationCallbacks: undefined as
    | {
        onSuccess?: (supplier: {
          id: string;
          code: string;
          name: string;
          location: string | null;
        }) => void;
        onError?: (error: Error) => void;
      }
    | undefined,
  supplierFormProps: undefined as
    | {
        onSubmit: (
          supplier: SupplierFormData,
          locations?: PendingSupplierLocation[],
        ) => void;
        errorMessage?: string;
        isSubmitting?: boolean;
        submitLabel?: string;
      }
    | undefined,
}));

vi.mock("@/components/suppliers/supplier-form", () => ({
  SupplierForm: (props: NonNullable<typeof mocks.supplierFormProps>) => {
    mocks.supplierFormProps = props;
    return <div data-testid="canonical-supplier-form" />;
  },
}));

vi.mock("@/hooks/use-suppliers", () => ({
  useCreateSupplierWithLocations: (callbacks: typeof mocks.mutationCallbacks) => {
    mocks.mutationCallbacks = callbacks;
    return {
      mutateAsync: mocks.mutateAsync,
      isSubmitting: false,
      isPending: mocks.isPending,
    };
  },
}));

vi.mock("./quick-add-dialog-shell", () => ({
  QuickAddDialogShell: (props: NonNullable<typeof mocks.shellProps>) => {
    mocks.shellProps = props;
    return props.children;
  },
}));

import { SupplierQuickAddDialog } from "./supplier-quick-add-dialog";

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("SupplierQuickAddDialog", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.mutateAsync.mockResolvedValue(undefined);
    mocks.isPending = false;
    mocks.mutationCallbacks = undefined;
    mocks.shellProps = undefined;
    mocks.supplierFormProps = undefined;
  });

  it("renders the canonical SupplierForm and submits its pending locations", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const html = renderToStaticMarkup(
      <SupplierQuickAddDialog
        isOpen
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );
    const supplier = { name: "New Supplier" } as SupplierFormData;
    const location = {
      name: "Source Yard",
      country: "Switzerland",
      stateRegion: "",
      city: "Zurich",
      address: "",
      gpsLatitude: 47,
      gpsLongitude: 8,
      distanceFromFacilityKm: null,
      distanceSource: null,
      isDefault: true,
    } satisfies PendingSupplierLocation;

    expect(html).toContain('data-testid="canonical-supplier-form"');
    expect(mocks.supplierFormProps?.submitLabel).toBe("Create supplier");

    await mocks.supplierFormProps?.onSubmit(supplier, [location]);
    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      supplier,
      locations: [location],
    });

    mocks.mutationCallbacks?.onSuccess?.({
      id: "supplier-2",
      code: "SUP-002",
      name: "New Supplier",
      location: "Zurich",
    });
    expect(onSuccess).toHaveBeenCalledWith({
      id: "supplier-2",
      code: "SUP-002",
      name: "New Supplier",
      subtitle: "Zurich",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("locks dismissal while creating and clears stale errors when reopened", async () => {
    const renderDialog = () => (
      <SupplierQuickAddDialog
        isOpen
        onClose={() => undefined}
        onSuccess={() => undefined}
      />
    );
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(renderDialog());
    });

    expect(mocks.shellProps?.dismissOnClickOutside).toBe(false);
    expect(mocks.shellProps?.dismissible).toBe(true);

    mocks.isPending = true;
    await act(async () => {
      renderer?.update(renderDialog());
    });
    expect(mocks.shellProps?.dismissible).toBe(false);
    expect(mocks.supplierFormProps?.isSubmitting).toBe(true);

    await act(async () => {
      mocks.mutationCallbacks?.onError?.(new Error("Supplier creation failed"));
    });
    expect(mocks.supplierFormProps?.errorMessage).toBe(
      "Supplier creation failed",
    );

    await act(async () => {
      mocks.shellProps?.onOpen?.();
    });
    expect(mocks.supplierFormProps?.errorMessage).toBeUndefined();

    await act(async () => renderer?.unmount());
  });
});
