import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { Control, FieldValues } from "react-hook-form";
import type { EntityOption } from "@/components/forms/entity-select/types";

const mocks = vi.hoisted(() => ({
  driftActionReason: undefined as string | null | undefined,
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

vi.mock("@/components/forms", async () => {
  const { FormError } = await import("@/components/forms/form-error");
  const { useWatch } = await vi.importActual<
    typeof import("react-hook-form")
  >("react-hook-form");
  const Wrapper = ({ children }: { children: ReactNode }) => children;

  return {
    FormError,
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
    FormInput: (props: ComponentProps<"input">) => <input {...props} />,
    FormSection: Wrapper,
    FormSpine: Wrapper,
    FormTextarea: () => null,
    MassMoistureFields: ({ wet, moisture }: ComponentProps<typeof import("@/components/forms/mass-moisture-fields").MassMoistureFields>) => (
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

vi.mock("@/hooks/use-geo", () => ({ useGeoCapabilities: vi.fn(), useRouteDistance: vi.fn() }));

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
vi.mock("@/hooks/use-suppliers", () => ({
  useSupplier: () => ({ data: undefined }),
  useSupplierLocationsBySupplier: () => ({ data: [] }),
}));
// The edit-mode refresh action has its own DOM test.
vi.mock("@/components/transport-legs/transport-distance-drift", () => ({
  DistanceDriftAction: (props: { disabledReason?: string | null }) => {
    mocks.driftActionReason = props.disabledReason;
    return null;
  },
  SAVE_BEFORE_REFRESH_REASON: "Save or discard your changes first.",
}));
vi.mock("@/hooks/use-transport-legs", () => ({
  useTransportLegsForEntity: () => ({ data: [{ distanceKm: 42, distanceSource: "manual" }] }),
}));
vi.mock("@/hooks/use-facilities", () => ({
  useFacility: () => ({ data: undefined }),
}));
vi.mock("@/components/transport-legs", () => ({ TransportRoutePreview: () => null }));

// The distance field renders the real FormField; its tooltips need a DOM.
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/ui", () => ({
  Button: () => null,
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
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
    deliveryDate: new Date("2026-10-06"),
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
        transportDistanceKm: undefined,
        transportDistanceSource: undefined,
        totalWetMassKg: mass,
        moisturePercent: 25,
        allocations: [{ storageLocationId: feedstock.storageLocationId, allocatedWetMassKg: mass }],
      }));
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  const buttonByText = (renderer: ReactTestRenderer, text: string) =>
    renderer.root.findAll((node) => node.type === "button" && [node.props.children].flat().includes(text))[0];
  const distanceInput = (renderer: ReactTestRenderer) =>
    renderer.root.findByType("form").findAllByType("input").find(input => input.props.name === "transportDistanceKm");
  async function renderForm(record: FeedstockWithRelations, onSubmit = vi.fn()) {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<FeedstockForm feedstock={record} onSubmit={onSubmit} />);
    });
    return { renderer, onSubmit };
  }
  const submit = (renderer: ReactTestRenderer) =>
    act(async () => { await renderer.root.findByType("form").props.onSubmit(); });

  it("shows the recorded leg distance read-only and omits it on save", async () => {
    const { renderer, onSubmit } = await renderForm(feedstock);
    try {
      expect(distanceInput(renderer)).toBeUndefined();
      const derived = renderer.root.findByProps({ id: "transportDistanceKm", readOnly: true });
      expect(derived.props.value).toBe("42");
      await submit(renderer);
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        transportDistanceKm: undefined, transportDistanceSource: undefined, distanceNote: undefined,
      }));
    } finally { await act(async () => renderer.unmount()); }
  });

  it("offers the refresh from location until the form has unsaved edits", async () => {
    const { renderer } = await renderForm(feedstock);
    try {
      expect(mocks.driftActionReason).toBeNull();
      await act(async () => {
        await renderer.root.findByProps({ name: "totalWetMassKg" }).props.onChange({ target: { name: "totalWetMassKg", value: 150 } });
      });
      expect(mocks.driftActionReason).toBe("Save or discard your changes first.");
    } finally { await act(async () => renderer.unmount()); }
  });

  it("sets an override with its source after Override unlocks entry", async () => {
    const { renderer, onSubmit } = await renderForm(feedstock);
    try {
      await act(async () => { buttonByText(renderer, "Override").props.onClick(); });
      await act(async () => {
        await distanceInput(renderer)!.props.onChange({ target: { name: "transportDistanceKm", value: "60" } });
      });
      await submit(renderer);
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        transportDistanceKm: 60, transportDistanceSource: "manual",
      }));
    } finally { await act(async () => renderer.unmount()); }
  });

  it("refuses an empty override instead of saving it", async () => {
    const { renderer, onSubmit } = await renderForm(feedstock);
    try {
      await act(async () => { buttonByText(renderer, "Override").props.onClick(); });
      await submit(renderer);
      expect(onSubmit).not.toHaveBeenCalled();
    } finally { await act(async () => renderer.unmount()); }
  });

  it.each(["", "0"])("refuses a typed override of %j instead of sending it", async (value) => {
    const { renderer, onSubmit } = await renderForm(feedstock);
    try {
      await act(async () => { buttonByText(renderer, "Override").props.onClick(); });
      await act(async () => {
        await distanceInput(renderer)!.props.onChange({ target: { name: "transportDistanceKm", value } });
      });
      await submit(renderer);
      expect(onSubmit).not.toHaveBeenCalled();
    } finally { await act(async () => renderer.unmount()); }
  });

  const overridden = { ...feedstock, distanceKmOverride: 60, distanceSource: "document", distanceNote: "Detour" } as FeedstockWithRelations;

  it("preserves a saved override by omitting it", async () => {
    const { renderer, onSubmit } = await renderForm(overridden);
    try {
      expect(distanceInput(renderer)?.props.readOnly).toBeUndefined();
      await submit(renderer);
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        transportDistanceKm: undefined, transportDistanceSource: undefined, distanceNote: undefined,
      }));
    } finally { await act(async () => renderer.unmount()); }
  });

  it("sends a re-entered override in full after the supplier changes", async () => {
    const { renderer, onSubmit } = await renderForm({ ...overridden, distanceSource: "manual", distanceNote: null } as FeedstockWithRelations);
    try {
      // A new supplier is a new route: its saved override no longer applies.
      await act(async () => {
        mocks.supplierDialogProps?.onSuccess({ id: "66666666-6666-4666-8666-666666666666", code: "SUP-2", name: "Supplier B" });
      });
      expect(distanceInput(renderer)).toBeUndefined();
      await act(async () => { buttonByText(renderer, "Override").props.onClick(); });
      await act(async () => {
        await distanceInput(renderer)!.props.onChange({ target: { name: "transportDistanceKm", value: "60" } });
      });
      await submit(renderer);
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        supplierId: "66666666-6666-4666-8666-666666666666",
        transportDistanceKm: 60, transportDistanceSource: "manual", distanceNote: null,
      }));
    } finally { await act(async () => renderer.unmount()); }
  });

  it("clears a saved override back to the derived distance with null", async () => {
    const { renderer, onSubmit } = await renderForm(overridden);
    try {
      await act(async () => { buttonByText(renderer, "Reset to default").props.onClick(); });
      expect(distanceInput(renderer)).toBeUndefined();
      await submit(renderer);
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        transportDistanceKm: null, transportDistanceSource: undefined, distanceNote: null,
      }));
    } finally { await act(async () => renderer.unmount()); }
  });

  it.each([90, 100])("keeps an intentional %s kg allocation override when the total changes", async (allocatedWetMassKg) => {
    const onSubmit = vi.fn();
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<FeedstockForm feedstock={feedstock} onSubmit={onSubmit} />);
    });
    try {
      for (const [name, value] of [["totalWetMassKg", 150], ["allocations.0.allocatedWetMassKg", allocatedWetMassKg], ["totalWetMassKg", 160]] as const) {
        await act(async () => {
          await renderer.root.findByProps({ name }).props.onChange({ target: { name, value } });
        });
      }
      await act(async () => {
        await renderer.root.findByType("form").props.onSubmit();
      });
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        totalWetMassKg: 160,
        allocations: [{ storageLocationId: feedstock.storageLocationId, allocatedWetMassKg }],
      }));
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});
