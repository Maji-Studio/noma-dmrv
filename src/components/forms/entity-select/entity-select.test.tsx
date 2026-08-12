import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const entityState = vi.hoisted(() => ({
  options: [] as Array<{
    id: string;
    code: string;
    name: string;
    subtitle?: string;
    remainingMass?: { wetKg: number | null; dryKg?: number | null };
  }>,
  selected: undefined as
    | {
        id: string;
        code: string;
        name: string;
        subtitle?: string;
        remainingMass?: { wetKg: number | null; dryKg?: number | null };
      }
    | undefined,
  selectedPending: true,
  listDataUpdatedAt: 0,
  selectedDataUpdatedAt: 0,
  selectedError: null as Error | null,
}));

vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({
    data: entityState.options,
    dataUpdatedAt: entityState.listDataUpdatedAt,
    isLoading: false,
    error: null,
  }),
  useEntityById: () => ({
    data: entityState.selected,
    dataUpdatedAt: entityState.selectedDataUpdatedAt,
    isPending: entityState.selectedPending,
    isError: entityState.selectedError !== null,
    error: entityState.selectedError,
  }),
}));

vi.mock("./driver-quick-add-dialog", () => ({
  DriverQuickAddDialog: () => null,
}));
vi.mock("./operator-quick-add-dialog", () => ({
  OperatorQuickAddDialog: () => null,
}));
vi.mock("./vehicle-quick-add-dialog", () => ({
  VehicleQuickAddDialog: () => null,
}));
vi.mock("./feedstock-type-quick-add-dialog", () => ({
  FeedstockTypeQuickAddDialog: () => null,
}));
vi.mock("./formulation-quick-add-dialog", () => ({
  FormulationQuickAddDialog: () => null,
}));
import {
  EntityOptionText,
  EntitySelect,
  shouldRenderCreateAction,
} from "./entity-select";

beforeEach(() => {
  entityState.options = [];
  entityState.selected = undefined;
  entityState.selectedPending = true;
  entityState.listDataUpdatedAt = 0;
  entityState.selectedDataUpdatedAt = 0;
  entityState.selectedError = null;
});

function render(value?: string): string {
  return renderToStaticMarkup(
    <EntitySelect
      entityType="reactor"
      value={value}
      onChange={() => undefined}
      placeholder="Select reactor"
    />,
  );
}

describe("EntitySelect selected-value display", () => {
  it("shows a loading selection state while display data is unresolved", () => {
    const html = render("reactor-1");

    expect(html).toContain("Loading selection…");
    expect(html).not.toContain(">Select reactor</span>");
    expect(html).toContain('aria-label="Clear selection"');
  });

  it("uses a synchronously available matching option without a loading flash", () => {
    entityState.options = [
      { id: "reactor-1", code: "R-1", name: "North Kiln" },
    ];

    const html = render("reactor-1");

    expect(html).toContain("North Kiln");
    expect(html).not.toContain("Loading selection…");
  });

  it("falls back to the placeholder once the fetch settles without a match", () => {
    entityState.selectedPending = false;

    const html = render("reactor-1");

    expect(html).toContain("Select reactor");
    expect(html).not.toContain("Loading selection…");
  });

  it("keeps the empty-state placeholder when no value is selected", () => {
    const html = render();

    expect(html).toContain("Select reactor");
    expect(html).not.toContain("Loading selection…");
  });

  it("shows selected remaining mass and merges its accessible description", () => {
    entityState.selected = {
      id: "reactor-1",
      code: "BIN-01",
      name: "North product bin",
      remainingMass: { wetKg: 3_000, dryKg: 2_900 },
    };
    entityState.selectedPending = false;

    const html = renderToStaticMarkup(
      <EntitySelect
        entityType="storageLocation"
        value="reactor-1"
        onChange={() => undefined}
        aria-describedby="field-helper"
        aria-invalid
      />,
    );

    expect(html).toContain(
      "Remaining wet mass: 3,000kg | dry mass: 2,900kg",
    );
    expect(html).toContain('aria-describedby="field-helper ');
    expect(html).toContain('aria-invalid="true"');
  });

  it("can limit the selected remaining mass caption to wet mass", () => {
    entityState.selected = {
      id: "order-1",
      code: "ORD-1",
      name: "Customer order",
      remainingMass: { wetKg: 500, dryKg: 409 },
    };
    entityState.selectedPending = false;

    const html = renderToStaticMarkup(
      <EntitySelect
        entityType="order"
        value="order-1"
        onChange={() => undefined}
        showRemainingDryMass={false}
      />,
    );

    expect(html).toContain("Remaining wet mass: 500kg");
    expect(html).not.toContain("dry mass");
  });

  it("uses list stock when its successful query is fresher while keeping the detail label", () => {
    entityState.options = [
      {
        id: "reactor-1",
        code: "BIN-01",
        name: "List label",
        remainingMass: { wetKg: 3_000, dryKg: 2_900 },
      },
    ];
    entityState.selected = {
      id: "reactor-1",
      code: "BIN-01",
      name: "Detail label",
      remainingMass: { wetKg: 2_000, dryKg: 1_900 },
    };
    entityState.listDataUpdatedAt = 200;
    entityState.selectedDataUpdatedAt = 100;
    entityState.selectedPending = false;

    const html = render("reactor-1");
    expect(html).toContain("Detail label");
    expect(html).not.toContain("List label");
    expect(html).toContain(
      "Remaining wet mass: 3,000kg | dry mass: 2,900kg",
    );
  });

  it("uses detail stock when its successful query is fresher", () => {
    entityState.options = [
      {
        id: "reactor-1",
        code: "BIN-01",
        name: "List label",
        remainingMass: { wetKg: 3_000, dryKg: 2_900 },
      },
    ];
    entityState.selected = {
      id: "reactor-1",
      code: "BIN-01",
      name: "Detail label",
      remainingMass: { wetKg: 2_000, dryKg: 1_900 },
    };
    entityState.listDataUpdatedAt = 100;
    entityState.selectedDataUpdatedAt = 200;
    entityState.selectedPending = false;

    expect(render("reactor-1")).toContain(
      "Remaining wet mass: 2,000kg | dry mass: 1,900kg",
    );
  });

  it("uses fresher list stock when a detail refresh fails with retained data", () => {
    entityState.options = [
      {
        id: "reactor-1",
        code: "BIN-01",
        name: "List label",
        remainingMass: { wetKg: 3_000, dryKg: 2_900 },
      },
    ];
    entityState.selected = {
      id: "reactor-1",
      code: "BIN-01",
      name: "Retained detail label",
      remainingMass: { wetKg: 2_000, dryKg: 1_900 },
    };
    entityState.listDataUpdatedAt = 200;
    // React Query retains the previous successful data and its timestamp when
    // a background refetch fails.
    entityState.selectedDataUpdatedAt = 100;
    entityState.selectedError = new Error("detail refresh failed");
    entityState.selectedPending = false;

    const html = render("reactor-1");
    expect(html).toContain("Retained detail label");
    expect(html).toContain(
      "Remaining wet mass: 3,000kg | dry mass: 2,900kg",
    );
  });

  it("does not render a selected helper for generic subtitles or no selection", () => {
    entityState.selected = {
      id: "reactor-1",
      code: "R-1",
      name: "North Kiln",
      subtitle: "Reactor description",
    };
    entityState.selectedPending = false;

    expect(render("reactor-1")).not.toContain("Reactor description");
    expect(render("reactor-1")).not.toContain("Remaining wet mass");

    entityState.selected = undefined;
    expect(render()).not.toContain("Remaining wet mass");
  });
});

describe("EntitySelect none option", () => {
  it("names the none state on the closed trigger instead of a placeholder", () => {
    const html = renderToStaticMarkup(
      <EntitySelect
        entityType="formulation"
        value=""
        onChange={() => undefined}
        noneOption={{ label: "None (Pure biochar)" }}
      />,
    );

    expect(html).toContain(">None (Pure biochar)</span>");
    expect(html).not.toContain(">Select formulation...</span>");
  });

  it("keeps the selected entity label over the none label", () => {
    entityState.options = [
      { id: "formulation-1", code: "F-1", name: "50/50 Mix" },
    ];

    const html = renderToStaticMarkup(
      <EntitySelect
        entityType="formulation"
        value="formulation-1"
        onChange={() => undefined}
        noneOption={{ label: "None (Pure biochar)" }}
      />,
    );

    expect(html).toContain("50/50 Mix");
    expect(html).not.toContain("None (Pure biochar)");
  });
});

describe("EntitySelect open option display", () => {
  it("keeps an explicitly allowed create action with non-empty options", () => {
    expect(
      shouldRenderCreateAction({
        allowCreate: true,
        hasCreateAction: true,
        isLoading: false,
        hasFetchError: false,
        optionCount: 1,
      }),
    ).toBe(true);
  });

  it("shows the option name and subtitle without exposing its internal code", () => {
    const html = renderToStaticMarkup(
      <EntityOptionText
        option={{
          id: "reactor-1",
          code: "RE-001",
          name: "North Kiln",
          subtitle: "Pyrolysis reactor",
        }}
      />,
    );

    expect(html).toContain("North Kiln");
    expect(html).toContain("Pyrolysis reactor");
    expect(html).not.toContain("RE-001");
  });
});
