import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { Control, FieldValues } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompositionRow } from "@/lib/biochar-composition";

interface CapturedEntitySelectProps {
  createLabel?: string;
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

const state = vi.hoisted(() => ({
  close: vi.fn(),
  dialog: undefined as CapturedDialogProps | undefined,
  massChange: vi.fn(),
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
  FormField: ({ children }: { children: ReactNode }) => children,
  FormInput: () => null,
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

import { IngredientBinField } from "./ingredient-bin-field";

const row: CompositionRow = {
  key: "ingredient-1",
  index: 0,
  formulationIngredientId: "formulation-ingredient-1",
  feedstockTypeId: "feedstock-type-manure",
  feedstockTypeName: "Manure",
  feedstockTypeCategory: "Agricultural residue",
  ratio: 0.2,
  suggestedMassKg: 100,
  deviationPercent: null,
  massKgFieldName: "ingredientBins.0.massKg",
  storageLocationFieldName: "ingredientBins.0.storageLocationId",
};

function renderField() {
  renderToStaticMarkup(
    <IngredientBinField
      row={row}
      control={{} as Control<FieldValues>}
      isSubmitting={false}
      facilityId="facility-1"
    />,
  );
}

beforeEach(() => {
  state.close.mockClear();
  state.dialog = undefined;
  state.massChange.mockClear();
  state.open.mockClear();
  state.select = undefined;
  state.storageChange.mockClear();
});

describe("IngredientBinField feedstock-bin quick add", () => {
  it("offers a feedstock-bin action using the row filters", () => {
    renderField();

    expect(state.select).toMatchObject({
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
});
