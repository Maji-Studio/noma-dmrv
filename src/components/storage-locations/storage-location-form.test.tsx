// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityOption } from "@/components/forms/entity-select/types";
import { FormDialogContext, type DialogFormState } from "@/components/ui/form-dialog-context";
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

function dirtyStates(ui: ReactNode) {
  const states: boolean[] = [];
  const actions = {
    report: (_id: object, formState: DialogFormState | null) => { if (formState) states.push(formState.dirty); },
    cancel: vi.fn(),
    markSaved: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FormDialogContext.Provider value={actions}>{ui}</FormDialogContext.Provider>
    </QueryClientProvider>,
  );
  return states;
}
const feedstockType = () => screen.getByRole("combobox", { name: /^Feedstock type/ });

describe("StorageLocationForm unsaved changes", () => {
  it.each([
    ["a preselected type", { defaultType: "feedstock_bin" as const }],
    ["a single allowed type", { allowedTypes: ["feedstock_bin"] as const }],
  ])("stays clean when the only feedstock type is picked for the operator on %s", async (_label, props) => {
    const states = dirtyStates(<StorageLocationForm {...props} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(feedstockType().textContent).toBe("Wood chips"));
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((dirty) => !dirty)).toBe(true);
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
