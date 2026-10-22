// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormDialogContext, type DialogFormState } from "@/components/ui/form-dialog-context";
import { DEFAULT_ORGANIZATION_SETTINGS } from "@/config/organization-settings";
import { FacilityForm } from "./facility-form";

const org = vi.hoisted(() => ({ defaults: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaultValues: () => ({ defaults: org.defaults, isLoading: false }),
}));
// The map and geocoder are not under test; the position inputs are.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/use-geo", () => ({
  useGeoCapabilities: () => ({ data: undefined }),
  useReverseGeocode: () => ({ data: undefined }),
}));
vi.mock("@/components/forms/position-picker/address-search", () => ({ AddressSearch: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

beforeEach(() => { org.defaults = { ...DEFAULT_ORGANIZATION_SETTINGS }; });
afterEach(cleanup);

function dirtyStates(ui: ReactNode) {
  const states: boolean[] = [];
  const actions = {
    report: (_id: object, state: DialogFormState | null) => { if (state) states.push(state.dirty); },
    cancel: vi.fn(),
    markSaved: vi.fn(),
  };
  const view = render(<FormDialogContext.Provider value={actions}>{ui}</FormDialogContext.Provider>);
  return { states, ...view };
}

describe("FacilityForm unsaved changes", () => {
  it.each([
    ["without an organization timezone", undefined],
    ["with an organization timezone", "Africa/Nairobi"],
  ])("stays clean when a fresh create form is left untouched %s", async (_label, defaultTimezone) => {
    org.defaults = { ...org.defaults, defaultTimezone };
    const { states, container } = dirtyStates(<FacilityForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // Focus and leave the timezone picker, as a keyboard user tabbing past it would.
    const timezone = screen.getByRole("combobox", { name: /Timezone/ });
    fireEvent.focus(timezone);
    fireEvent.blur(timezone);
    // Any later recompute of the dirty flag must still find nothing changed.
    fireEvent.change(container.querySelector('input[name="name"]')!, { target: { value: "x" } });
    fireEvent.change(container.querySelector('input[name="name"]')!, { target: { value: "" } });
    await waitFor(() => expect(states.length).toBeGreaterThan(1));
    expect(states.at(-1)).toBe(false);
  });

  it("turns dirty once the operator types a name", async () => {
    const { states, container } = dirtyStates(<FacilityForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(container.querySelector('input[name="name"]')!, { target: { value: "North site" } });
    await waitFor(() => expect(states.at(-1)).toBe(true));
  });
});
