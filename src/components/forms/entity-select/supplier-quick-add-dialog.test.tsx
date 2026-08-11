import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { PendingSupplierLocation } from "@/components/suppliers/supplier-form";
import type { SupplierFormData } from "@/schemas/suppliers";

const mocks = vi.hoisted(() => ({
  handleSubmit: vi.fn(),
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

vi.mock("@/fn/suppliers", () => ({
  createSupplierWithLocationsFn: vi.fn(),
}));

vi.mock("@/hooks/use-quick-add-submit", () => ({
  useQuickAddSubmit: () => ({
    error: null,
    handleSubmit: mocks.handleSubmit,
    isSubmitting: false,
  }),
}));

vi.mock("./quick-add-dialog-shell", () => ({
  QuickAddDialogShell: ({ children }: { children: ReactNode }) => children,
}));

import { SupplierQuickAddDialog } from "./supplier-quick-add-dialog";

describe("SupplierQuickAddDialog", () => {
  it("renders the canonical SupplierForm and submits its pending locations", () => {
    const html = renderToStaticMarkup(
      <SupplierQuickAddDialog
        isOpen
        onClose={() => undefined}
        onSuccess={() => undefined}
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

    mocks.supplierFormProps?.onSubmit(supplier, [location]);
    expect(mocks.handleSubmit).toHaveBeenCalledWith({
      supplier,
      locations: [location],
    });
  });
});
