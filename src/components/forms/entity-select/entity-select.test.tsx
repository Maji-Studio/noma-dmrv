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
}));

vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: () => ({
    data: entityState.options,
    isLoading: false,
    error: null,
  }),
  useEntityById: () => ({
    data: entityState.selected,
    isPending: entityState.selectedPending,
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

import { EntityOptionText, EntitySelect } from "./entity-select";

beforeEach(() => {
  entityState.options = [];
  entityState.selected = undefined;
  entityState.selectedPending = true;
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

  it("keeps fresh remaining mass when cached selected details are incomplete", () => {
    entityState.options = [
      {
        id: "reactor-1",
        code: "BIN-01",
        name: "North product bin",
        remainingMass: { wetKg: 3_000, dryKg: 2_900 },
      },
    ];
    entityState.selected = {
      id: "reactor-1",
      code: "BIN-01",
      name: "North product bin",
    };
    entityState.selectedPending = false;

    expect(render("reactor-1")).toContain(
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

describe("EntitySelect open option display", () => {
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
