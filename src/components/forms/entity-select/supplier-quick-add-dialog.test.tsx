import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { PendingSupplierLocation } from "@/components/suppliers/supplier-form";
import type { SupplierFormData } from "@/schemas/suppliers";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
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
      isPending: false,
    };
  },
}));

vi.mock("./quick-add-dialog-shell", () => ({
  QuickAddDialogShell: ({ children }: { children: ReactNode }) => children,
}));

import { SupplierQuickAddDialog } from "./supplier-quick-add-dialog";

describe("SupplierQuickAddDialog", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.mutateAsync.mockResolvedValue(undefined);
    mocks.mutationCallbacks = undefined;
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
});
