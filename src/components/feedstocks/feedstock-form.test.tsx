import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { Control, FieldValues } from "react-hook-form";
import type { EntityOption } from "@/components/forms/entity-select/types";

const mocks = vi.hoisted(() => ({
  supplierSelectProps: undefined as
    | {
        allowCreate?: boolean;
        onCreateNew?: () => void;
      }
    | undefined,
  supplierDialogProps: undefined as
    | {
        isOpen: boolean;
        onSuccess: (supplier: EntityOption) => void;
      }
    | undefined,
}));

vi.mock("@/components/forms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/forms")>();
  const { useWatch } = await vi.importActual<
    typeof import("react-hook-form")
  >("react-hook-form");
  const Wrapper = ({ children }: { children: ReactNode }) => children;

  return {
    ...actual,
    FormEntitySelect: ({
      control,
      name,
      allowCreate,
      onCreateNew,
    }: {
      control: Control<FieldValues>;
      name: string;
      allowCreate?: boolean;
      onCreateNew?: () => void;
    }) => {
      const value = useWatch({ control, name });
      if (name === "supplierId") {
        mocks.supplierSelectProps = { allowCreate, onCreateNew };
      }
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
    MassMoistureFields: ({ wet, moisture }: ComponentProps<typeof actual.MassMoistureFields>) => (
      <>
        <input {...wet.registration} />
        <input {...moisture.registration} />
      </>
    ),
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

vi.mock("@/components/forms/entity-select", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/components/forms/entity-select")
  >();
  const { useState } = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useQuickAddDialog: () => {
      const [isOpen, setIsOpen] = useState(false);
      return {
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
      };
    },
    SupplierQuickAddDialog: (
      props: NonNullable<typeof mocks.supplierDialogProps>,
    ) => {
      mocks.supplierDialogProps = props;
      return null;
    },
  };
});

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
vi.mock("./bin-allocation-row", () => ({
  BinAllocationRow: ({ massRegister }: ComponentProps<typeof import("./bin-allocation-row").BinAllocationRow>) => <input {...massRegister} />,
}));
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
    mocks.supplierSelectProps = undefined;
    mocks.supplierDialogProps = undefined;
  });

  it("opens the owned dialog from the production create action and selects its supplier", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<FeedstockForm onSubmit={vi.fn()} />);
    });

    const selectedSupplier = () =>
      renderer?.root.findByProps({ "data-testid": "selected-supplier-id" });

    expect(selectedSupplier()?.props["data-value"]).toBe("");
    expect(mocks.supplierSelectProps?.allowCreate).toBe(true);
    expect(mocks.supplierSelectProps?.onCreateNew).toBeTypeOf("function");
    expect(mocks.supplierDialogProps).toBeDefined();
    expect(mocks.supplierDialogProps?.isOpen).toBe(false);

    await act(async () => {
      mocks.supplierSelectProps?.onCreateNew?.();
    });

    expect(mocks.supplierDialogProps?.isOpen).toBe(true);

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


describe("FeedstockForm single-bin mass editing", () => {
  const feedstock = {
    id: "11111111-1111-4111-8111-111111111111",
    facilityId: "22222222-2222-4222-8222-222222222222",
    supplierId: "33333333-3333-4333-8333-333333333333",
    feedstockTypeId: "44444444-4444-4444-8444-444444444444",
    storageLocationId: "55555555-5555-4555-8555-555555555555",
    massWetKg: 100,
    moistureContentPercent: 25,
  } as FeedstockWithRelations;

  it.each([150, 80])("submits an edited total of %s kg as its bin allocation", async (mass) => {
    const onSubmit = vi.fn();
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<FeedstockForm feedstock={feedstock} onSubmit={onSubmit} />);
    });
    try {
      // Drive the registered input and real resolver/submit path. The list's
      // update mutation reads this allocation, so a stale value loses the edit.
      await act(async () => {
        await renderer.root.findByProps({ name: "totalWetMassKg" }).props.onChange({
          target: { name: "totalWetMassKg", value: mass },
        });
      });
      await act(async () => {
        await renderer.root.findByType("form").props.onSubmit();
      });
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        totalWetMassKg: mass,
        moisturePercent: 25,
        allocations: [{ storageLocationId: feedstock.storageLocationId, allocatedWetMassKg: mass }],
      }));
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it("keeps an intentional allocation override when the total changes", async () => {
    const onSubmit = vi.fn();
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<FeedstockForm feedstock={feedstock} onSubmit={onSubmit} />);
    });
    try {
      for (const [name, value] of [["allocations.0.allocatedWetMassKg", 90], ["totalWetMassKg", 150]] as const) {
        await act(async () => {
          await renderer.root.findByProps({ name }).props.onChange({ target: { name, value } });
        });
      }
      await act(async () => {
        await renderer.root.findByType("form").props.onSubmit();
      });
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        totalWetMassKg: 150,
        allocations: [{ storageLocationId: feedstock.storageLocationId, allocatedWetMassKg: 90 }],
      }));
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});
