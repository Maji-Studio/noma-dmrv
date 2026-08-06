import { renderToStaticMarkup } from "react-dom/server";
import { useState, type ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompositionRow } from "@/lib/biochar-composition";

interface CapturedEntitySelectProps {
  allowCreate?: boolean;
  createLabel?: string;
  disabled?: boolean;
  onBlur?: () => void;
  emptyHint?: { message: string };
  filterBy?: Record<string, string>;
  onCreateNew?: () => void;
}

interface CapturedDialogProps {
  allowedTypes?: readonly string[];
  defaultBinType?: string;
  defaultFeedstockTypeId?: string;
  facilityId: string;
  feedstockTypeUsage?: string;
  lockFeedstockType?: boolean;
  onSuccess: (entity: { id: string }) => void;
}

interface CapturedMassInputProps {
  disabled?: boolean;
  onChange?: (event: { currentTarget: { value: string } }) => void;
  value?: unknown;
}

const state = vi.hoisted(() => ({
  close: vi.fn(),
  dialog: undefined as CapturedDialogProps | undefined,
  fieldLabels: [] as string[],
  massChange: vi.fn(),
  massInput: undefined as CapturedMassInputProps | undefined,
  open: vi.fn(),
  select: undefined as CapturedEntitySelectProps | undefined,
  storageChange: vi.fn(),
}));

vi.mock("react-hook-form", () => ({
  Controller: ({
    name,
    render,
  }: {
    name: string;
    render: (args: {
      field: {
        name: string;
        onBlur: () => void;
        onChange: (value: unknown) => void;
        ref: () => void;
        value: string;
      };
      fieldState: { error: undefined };
    }) => ReactNode;
  }) =>
    render({
      field: {
        name,
        onBlur: () => undefined,
        onChange: name.endsWith("storageLocationId")
          ? state.storageChange
          : state.massChange,
        ref: () => undefined,
        value: "",
      },
      fieldState: { error: undefined },
    }),
}));

vi.mock("@/components/forms", () => ({
  EntitySelect: (props: CapturedEntitySelectProps) => {
    state.select = props;
    return null;
  },
  FormField: ({
    children,
    label,
  }: {
    children: ReactNode;
    label: string;
  }) => {
    state.fieldLabels.push(label);
    return children;
  },
  FormInput: (props: CapturedMassInputProps) => {
    state.massInput = props;
    return null;
  },
}));

vi.mock("@/components/forms/entity-select", () => ({
  StorageLocationQuickAddDialog: (props: CapturedDialogProps) => {
    state.dialog = props;
    return null;
  },
  useQuickAddDialog: () => ({
    close: state.close,
    isOpen: false,
    open: state.open,
  }),
}));

import {
  IngredientBinField,
  IngredientMassInput,
  parseIngredientMassDraft,
} from "./ingredient-bin-field";

const row: CompositionRow = {
  key: "ingredient-1",
  index: 0,
  formulationIngredientId: "formulation-ingredient-1",
  feedstockTypeId: "feedstock-type-manure",
  feedstockTypeName: "Manure",
  feedstockTypeCategory: "Agricultural residue",
  ratio: 0.2,
  massKgFieldName: "ingredientBins.0.massKg",
  storageLocationFieldName: "ingredientBins.0.storageLocationId",
};

function renderField(allocationFrozen = false) {
  return renderToStaticMarkup(
    <IngredientBinField
      row={row}
      control={{} as Control<FieldValues>}
      isSubmitting={false}
      facilityId="facility-1"
      allocationFrozen={allocationFrozen}
    />,
  );
}

function IngredientMassHarness() {
  const [value, setValue] = useState<number | null>(null);
  return (
    <IngredientMassInput
      name={row.massKgFieldName}
      value={value}
      onChange={(next) => {
        state.massChange(next);
        setValue(next);
      }}
      onBlur={() => undefined}
      inputRef={() => undefined}
      disabled={false}
      error={false}
    />
  );
}

beforeEach(() => {
  state.close.mockClear();
  state.dialog = undefined;
  state.fieldLabels = [];
  state.massChange.mockClear();
  state.massInput = undefined;
  state.open.mockClear();
  state.select = undefined;
  state.storageChange.mockClear();
});

describe("IngredientBinField feedstock-bin quick add", () => {
  it("labels the operator-entered ingredient mass as wet mass", () => {
    renderField();
    expect(state.fieldLabels).toContain("Wet mass (kg)");
  });

  it.each([
    ["20", 20],
    ["", null],
    ["-", undefined],
  ])("parses the mass draft %j as %j", (displayValue, expected) => {
    expect(parseIngredientMassDraft(displayValue)).toBe(expected);
  });

  it("keeps a trailing decimal while the operator continues typing", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<IngredientMassHarness />);
    });

    act(() => {
      state.massInput?.onChange?.({ currentTarget: { value: "1." } });
    });
    expect(state.massInput?.value).toBe("1.");

    act(() => {
      state.massInput?.onChange?.({ currentTarget: { value: "1.5" } });
    });
    expect(state.massInput?.value).toBe("1.5");
    expect(state.massChange).toHaveBeenLastCalledWith(1.5);

    act(() => renderer.unmount());
  });

  it("clears the committed ingredient mass when the draft is cleared", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<IngredientMassHarness />);
    });
    act(() => {
      state.massInput?.onChange?.({ currentTarget: { value: "2" } });
    });
    act(() => {
      state.massInput?.onChange?.({ currentTarget: { value: "" } });
    });

    expect(state.massInput?.value).toBe("");
    expect(state.massChange).toHaveBeenLastCalledWith(null);

    act(() => renderer.unmount());
  });

  it("offers a feedstock-bin action using the row filters", () => {
    renderField();

    expect(state.select).toMatchObject({
      allowCreate: true,
      createLabel: "Create Manure feedstock bin",
      emptyHint: {
        message:
          "No Manure feedstock bins. Create a bin here, then record a feedstock intake to add stock.",
      },
      filterBy: {
        facilityId: "facility-1",
        type: "feedstock_bin",
        feedstockTypeId: "feedstock-type-manure",
        feedstockTypeUsage: "blend",
      },
    });

    state.select?.onCreateNew?.();
    expect(state.open).toHaveBeenCalledOnce();
  });

  it("fixes the dialog context and selects the created storage location", () => {
    renderField();

    expect(state.dialog).toMatchObject({
      allowedTypes: ["feedstock_bin"],
      defaultBinType: "feedstock_bin",
      defaultFeedstockTypeId: "feedstock-type-manure",
      facilityId: "facility-1",
      feedstockTypeUsage: "blend",
      lockFeedstockType: true,
    });

    state.dialog?.onSuccess({ id: "storage-location-1" });
    expect(state.storageChange).toHaveBeenCalledWith("storage-location-1");
    expect(state.close).toHaveBeenCalledOnce();
  });

  it("disables both allocation controls only when the source allocation is frozen", () => {
    renderField();
    expect(state.select?.disabled).toBe(false);
    expect(state.massInput?.disabled).toBe(false);

    renderField(true);
    expect(state.select).toMatchObject({
      allowCreate: false,
      disabled: true,
      onCreateNew: undefined,
    });
    expect(state.massInput?.disabled).toBe(true);
  });
});
