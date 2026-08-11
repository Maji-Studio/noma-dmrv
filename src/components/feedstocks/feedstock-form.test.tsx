import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";
import type { EntityOption } from "@/components/forms/entity-select/types";

const mocks = vi.hoisted(() => ({
  supplierDialogProps: undefined as
    | {
        onSuccess: (supplier: EntityOption) => void;
      }
    | undefined,
}));

vi.mock("@/components/forms", async () => {
  const { useWatch } = await vi.importActual<
    typeof import("react-hook-form")
  >("react-hook-form");
  const Wrapper = ({ children }: { children: ReactNode }) => children;

  return {
    FormEntitySelect: ({
      control,
      name,
    }: {
      control: Control<FieldValues>;
      name: string;
    }) => {
      const value = useWatch({ control, name });
      return name === "supplierId" ? (
        <output
          data-testid="selected-supplier-id"
          data-value={String(value ?? "")}
        />
      ) : null;
    },
    FormField: Wrapper,
    FormInput: () => null,
    FormSection: Wrapper,
    FormSpine: Wrapper,
    FormTextarea: () => null,
    MassMoistureFields: () => null,
    ResolvedErrorRevalidator: () => null,
    makeCertFieldStatus: () => () => "neutral",
    resolveCertFieldStatus: () => "neutral",
  };
});

vi.mock("@/components/forms/form-actions", () => ({
  FormActions: () => null,
}));

vi.mock("@/components/forms/form-select", () => ({
  FormSelect: () => null,
}));

vi.mock("@/components/forms/entity-select", async () => {
  const { useState } = await vi.importActual<typeof import("react")>("react");
  return {
    useQuickAddDialog: () => {
      const [isOpen, setIsOpen] = useState(false);
      return {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
      };
    },
  };
});

vi.mock(
  "@/components/forms/entity-select/supplier-quick-add-dialog",
  () => ({
    SupplierQuickAddDialog: (props: NonNullable<typeof mocks.supplierDialogProps>) => {
      mocks.supplierDialogProps = props;
      return null;
    },
  }),
);

vi.mock(
  "@/components/forms/entity-select/vehicle-quick-add-dialog",
  () => ({ VehicleQuickAddDialog: () => null }),
);
vi.mock(
  "@/components/forms/entity-select/feedstock-type-quick-add-dialog",
  () => ({ FeedstockTypeQuickAddDialog: () => null }),
);
vi.mock(
  "@/components/forms/entity-select/storage-location-quick-add-dialog",
  () => ({ StorageLocationQuickAddDialog: () => null }),
);

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
}));
vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaultValues: () => ({ defaults: { defaultTripType: "return" } }),
}));
vi.mock("@/hooks/use-suppliers", () => ({
  useSupplier: () => ({ data: undefined }),
  useSupplierLocationsBySupplier: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-transport-legs", () => ({
  useTransportLegsForEntity: () => ({ data: undefined }),
}));

vi.mock("@/components/ui", () => ({ Button: () => null }));
vi.mock("@/components/ui/actionable-focus-target", () => ({
  ActionableFocusTarget: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./bin-allocation-row", () => ({ BinAllocationRow: () => null }));
vi.mock("./feedstock-trailing-sections", () => ({
  FeedstockEvidenceSection: () => null,
}));
vi.mock("./wet-mass-warning", () => ({ WetMassWarning: () => null }));
vi.mock("./feedstock-allocation-summary", () => ({
  FeedstockAllocationSummary: () => null,
}));

import { FeedstockForm } from "./feedstock-form";

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("FeedstockForm supplier quick-add wiring", () => {
  beforeEach(() => {
    mocks.supplierDialogProps = undefined;
  });

  it("selects the supplier returned by the production quick-add callback", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<FeedstockForm onSubmit={vi.fn()} />);
    });

    const selectedSupplier = () =>
      renderer?.root.findByProps({ "data-testid": "selected-supplier-id" });

    expect(selectedSupplier()?.props["data-value"]).toBe("");
    expect(mocks.supplierDialogProps).toBeDefined();

    await act(async () => {
      mocks.supplierDialogProps?.onSuccess({
        id: "supplier-2",
        code: "SUP-002",
        name: "New Supplier",
      });
    });

    expect(selectedSupplier()?.props["data-value"]).toBe("supplier-2");
    await act(async () => renderer?.unmount());
  });
});
