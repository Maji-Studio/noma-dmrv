import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const entityState = vi.hoisted(() => ({
  options: [] as Array<{
    id: string;
    code: string;
    name: string;
    subtitle?: string;
  }>,
  selected: undefined as
    | { id: string; code: string; name: string; subtitle?: string }
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

import {
  EntityOptionText,
  EntitySelect,
  shouldRenderCreateAction,
} from "./entity-select";

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
