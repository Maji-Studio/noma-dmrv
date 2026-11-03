// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityOption } from "@/components/forms/entity-select/types";
import { expectStayedClean, renderReportingDirty } from "../../../tests/helpers/form-dialog-dirty";
import type { StorageLocation } from "@/db/schema/facilities";
import { StorageLocationForm } from "./storage-location-form";

const state = vi.hoisted(() => ({ options: [] as EntityOption[] }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-one" }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "" }),
}));
vi.mock("@/hooks/use-refresh-entity-options-on-return", () => ({ useRefreshEntityOptionsOnReturn: () => () => {} }));
vi.mock("@/hooks/use-entities", () => ({
  useEntityOptions: ({ entityType }: { entityType: string }) => ({
    data: entityType === "feedstockType" ? state.options : [], isLoading: false, error: null,
  }),
  useEntityById: (_type: string, id: string | undefined) => ({ data: state.options.find((option) => option.id === id), isPending: false }),
}));
vi.mock("@/hooks/use-entity-edit-record", () => ({ isEditableEntityType: () => false, useCanManageFeedstockTypes: () => false }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const WOOD_CHIPS: EntityOption = { id: "feedstock-one", code: "WC", name: "Wood chips" };
const HUSKS: EntityOption = { id: "feedstock-two", code: "RH", name: "Rice husks" };

beforeEach(() => {
  state.options = [WOOD_CHIPS];
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);

// The quick-add dialogs the selects mount (closed) read the query client.
function queryWrapper() {
  const client = new QueryClient();
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const dirtyStates = (ui: ReactNode) => renderReportingDirty(ui, { wrapper: queryWrapper() }).states;
const feedstockType = () => screen.getByRole("combobox", { name: /^Feedstock type/ });

describe("StorageLocationForm unsaved changes", () => {
  it.each([
    ["a preselected type", { defaultType: "feedstock_bin" as const }],
    ["a single allowed type", { allowedTypes: ["feedstock_bin"] as const }],
  ])("stays clean when the only feedstock type is picked for the operator on %s", async (_label, props) => {
    const states = dirtyStates(<StorageLocationForm {...props} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(feedstockType().textContent).toBe("Wood chips"));
    expectStayedClean(states);
  });

  it("stays clean on a fresh create form before a storage type is chosen", async () => {
    const states = dirtyStates(<StorageLocationForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // Typing and clearing a name makes the form recompute its dirty flag.
    const name = screen.getByRole("textbox", { name: /^Bin name/ });
    fireEvent.change(name, { target: { value: "Bin 7" } });
    fireEvent.change(name, { target: { value: "" } });
    await waitFor(() => expect(states.length).toBeGreaterThan(1));
    expect(states.at(-1)).toBe(false);
  });

  it("turns dirty once the operator picks a feedstock type", async () => {
    state.options = [WOOD_CHIPS, HUSKS];
    const states = dirtyStates(<StorageLocationForm defaultType="feedstock_bin" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(feedstockType());
    fireEvent.click(screen.getByTestId("entity-option-feedstock-two"));
    await waitFor(() => expect(states.at(-1)).toBe(true));
  });
});

describe("StorageLocationForm feedstock draw method", () => {
  const render = (ui: ReactNode) => renderReportingDirty(ui, { wrapper: queryWrapper() });

  it("offers In order and Mass weighted, then Oldest or Newest first, for a feedstock bin", () => {
    render(<StorageLocationForm defaultType="feedstock_bin" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    const method = screen.getByRole("group", { name: /Draw method/ });
    expect(method.textContent).toContain("Mass weighted");
    expect(method.textContent).toContain("In order");
    expect(method.textContent).toContain("deliver");
    const order = screen.getByRole("group", { name: /Draw order/ });
    expect(order.textContent).toContain("Oldest first");
    expect(order.textContent).toContain("Newest first");
    expect(screen.queryByText(/Default draw order/)).toBeNull();
    expect(screen.queryByText(/sub-bin/)).toBeNull();
  });

  it("hides the draw order for Mass weighted", () => {
    render(<StorageLocationForm defaultType="feedstock_bin" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: /Mass weighted/ }));
    expect(screen.queryByRole("group", { name: /Draw order/ })).toBeNull();
  });

  it("keeps the output bin wording for a biochar bin", () => {
    render(<StorageLocationForm defaultType="biochar_bin" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("group", { name: /Stock mode/ })).toBeTruthy();
    expect(screen.getByRole("group", { name: /Default draw order/ })).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Draw method/ })).toBeNull();
  });

  it("asks for the merge time when an existing oldest-first bin becomes Mass weighted", () => {
    const bin = { id: "bin", name: "Bin 1", type: "feedstock_bin", facilityId: "facility-one", feedstockTypeId: "feedstock-one", stockMode: "split", drawOrder: "oldest_first", capacityKg: null, storageMethod: null, storageDescription: null, formulationId: null, version: 1 } as unknown as StorageLocation;
    render(<StorageLocationForm storageLocation={bin} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/Mass weighted from/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Mass weighted/ }));
    expect(screen.getByText(/Mass weighted from/)).toBeTruthy();
    expect(screen.queryByText(/Merged at/)).toBeNull();
    expect(document.body.textContent).toContain("Draws from this time on are mass weighted");
  });
});
