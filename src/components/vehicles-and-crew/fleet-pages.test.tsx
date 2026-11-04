// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { inUseDeleteRefusal } from "@/lib/delete-refusal";
import {
  StaleVersionError,
  STALE_VERSION_CONFLICT_CODE,
  STALE_VERSION_MESSAGE,
} from "@/lib/stale-version";

const state = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  lists: {} as Record<string, unknown[]>,
  loading: {} as Record<string, boolean>,
  fetching: {} as Record<string, boolean>,
  removeVehicle: vi.fn(),
  removeDriver: vi.fn(),
  removeOperator: vi.fn(),
  openCreate: null as null | (() => void),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("nuqs", async () => {
  const React = await import("react");
  return {
    parseAsString: { withOptions: () => ({}) },
    parseAsStringLiteral: () => ({ withDefault: () => ({ withOptions: () => ({ default: "driver" }) }) }),
    useQueryState: (key: string, parser?: { default?: string }) => {
      const [, force] = React.useReducer((n: number) => n + 1, 0);
      return [
        state.query[key] ?? parser?.default ?? null,
        (value: string | null) => {
          state.query[key] = value;
          force();
          return Promise.resolve(new URLSearchParams());
        },
      ];
    },
  };
});
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: (open: () => void) => {
    state.openCreate = open;
  },
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: state.toastSuccess, error: state.toastError }),
}));
vi.mock("@/hooks/use-fleet", () => ({
  useFleetList: (kind: string) => ({
    data: state.lists[kind],
    isLoading: state.loading[kind] ?? false,
    isFetching: state.fetching[kind] ?? false,
    error: null,
    refetch: vi.fn(),
  }),
  useDeleteVehicle: () => ({ mutateAsync: state.removeVehicle, isPending: false }),
  useDeleteDriver: () => ({ mutateAsync: state.removeDriver, isPending: false }),
  useDeleteOperator: () => ({ mutateAsync: state.removeOperator, isPending: false }),
}));
vi.mock("./fleet-sheet-forms", () => ({
  FleetSheetForm: ({ kind, record }: { kind: string; record: { name: string } | null }) => (
    <form aria-label={`${kind} form`}>{record ? `editing ${record.name}` : "new"}</form>
  ),
}));

import { CrewPage } from "./crew-page";
import { VehiclesPage } from "./vehicles-page";

const vehicle = { id: "veh-1", code: "VEH-001", name: "Feedstock truck", version: 1, vehicleType: "truck", identifier: "ZH 123", fuelType: "Diesel", fuelConsumptionLPerKm: 0.3, modelYear: 2019 };
const driver = { id: "drv-1", code: "DRV-001", name: "Amina Okoye", version: 1, licenseNumber: "L-1", contactPhone: null };
const operator = { id: "opr-1", name: "Joseph Banda", version: 1, credentials: "Kiln lead", contactPhone: null };

beforeEach(() => {
  state.query = {};
  state.lists = { vehicle: [vehicle], driver: [driver], operator: [operator] };
  state.loading = {};
  state.fetching = {};
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
  state.removeVehicle.mockReset().mockResolvedValue(undefined);
  state.removeDriver.mockReset().mockResolvedValue(undefined);
  state.removeOperator.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

// `hidden`: an open sheet hides the rest of the page from the accessibility tree.
const tab = (name: RegExp) => screen.getByRole("tab", { name, hidden: true });

function rowMenu(label: string, item: string) {
  // The table renders a card list beside it that CSS hides; use the first.
  fireEvent.click(screen.getAllByRole("button", { name: label })[0]!);
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

describe("CrewPage", () => {
  it("shows a tab per kind with its count and opens on Drivers", () => {
    render(<CrewPage />);
    expect(screen.getByRole("heading", { name: "Crew" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /^Vehicles/ })).toBeNull();
    expect(tab(/^Drivers\s*1$/).getAttribute("aria-selected")).toBe("true");
    expect(tab(/^Operators\s*1$/).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("table", { name: "Drivers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New driver" })).toBeTruthy();
  });

  it("opens the tab named in the URL and the header button follows it", () => {
    state.query.tab = "operator";
    render(<CrewPage />);
    expect(tab(/^Operators/).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("table", { name: "Operators" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New operator" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New driver" })).toBeNull();
  });

  it("switches tab on click, keeps the choice in the URL and drops a kind link", () => {
    state.query.driver = "drv-1";
    render(<CrewPage />);
    fireEvent.click(tab(/^Operators/));
    expect(state.query.tab).toBe("operator");
    expect(state.query.driver).toBeNull();
    expect(screen.getByRole("button", { name: "New operator", hidden: true })).toBeTruthy();
  });

  it("moves between tabs with the arrow keys, Home and End", () => {
    render(<CrewPage />);
    fireEvent.keyDown(tab(/^Drivers/), { key: "ArrowRight" });
    expect(state.query.tab).toBe("operator");
    fireEvent.keyDown(tab(/^Operators/), { key: "ArrowRight" });
    expect(state.query.tab).toBe("driver");
    fireEvent.keyDown(tab(/^Drivers/), { key: "End" });
    expect(state.query.tab).toBe("operator");
    fireEvent.keyDown(tab(/^Operators/), { key: "Home" });
    expect(state.query.tab).toBe("driver");
    fireEvent.keyDown(tab(/^Drivers/), { key: "ArrowLeft" });
    expect(state.query.tab).toBe("operator");
    // Only the selected tab is a tab stop.
    expect(tab(/^Operators/).getAttribute("tabindex")).toBe("0");
    expect(tab(/^Drivers/).getAttribute("tabindex")).toBe("-1");
  });

  it("opens the create sheet from the header button and from a create link", () => {
    state.query.tab = "operator";
    render(<CrewPage />);
    fireEvent.click(screen.getByRole("button", { name: "New operator" }));
    expect(screen.getByText("Create operator")).toBeTruthy();
    expect(screen.getByRole("form", { name: "operator form" }).textContent).toBe("new");
    cleanup();

    state.query = {};
    render(<CrewPage />);
    expect(screen.queryByText("Create driver")).toBeNull();
    act(() => state.openCreate!());
    expect(screen.getByText("Create driver")).toBeTruthy();
  });

  it("opens a row in the view sheet and edits it from there", () => {
    render(<CrewPage />);
    fireEvent.click(screen.getAllByRole("link", { name: "Amina Okoye" })[0]!);
    const sheet = screen.getByRole("dialog");
    // Code first, name as the subtitle.
    expect(within(sheet).getByRole("heading").textContent).toBe("DRV-001");
    expect(within(sheet).getByText("Amina Okoye")).toBeTruthy();
    expect(within(sheet).getByText("L-1")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Edit driver" }));
    expect(screen.getByRole("form", { name: "driver form" }).textContent).toBe("editing Amina Okoye");
  });

  it("links each row to its record on the open tab", () => {
    state.query.tab = "operator";
    render(<CrewPage />);
    expect(screen.getAllByRole("link", { name: "Joseph Banda" })[0]!.getAttribute("href")).toBe(
      "/crew?operator=opr-1",
    );
  });

  it("opens a linked record's view sheet on its own tab and keeps the tab on close", () => {
    state.query = { operator: "opr-1" };
    render(<CrewPage />);
    expect(tab(/^Operators/).getAttribute("aria-selected")).toBe("true");
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("Joseph Banda")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Edit operator" })).toBeTruthy();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(state.query.operator).toBeNull();
    expect(state.query.tab).toBe("operator");
  });

  it("says so and clears the link when the record is gone", () => {
    state.query = { driver: "drv-gone", mode: "edit" };
    render(<CrewPage />);
    expect(state.toastError).toHaveBeenCalledWith("Linked driver could not be opened");
    expect(state.toastError).toHaveBeenCalledTimes(1);
    expect(state.query.driver).toBeNull();
    expect(state.query.mode).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("waits for a refetching list before calling a linked record gone", () => {
    state.query = { driver: "drv-new" };
    state.fetching.driver = true;
    const { rerender } = render(<CrewPage />);
    expect(state.toastError).not.toHaveBeenCalled();
    expect(state.query.driver).toBe("drv-new");

    state.fetching.driver = false;
    state.lists.driver = [driver, { ...driver, id: "drv-new", name: "New driver" }];
    rerender(<CrewPage />);
    expect(state.toastError).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog")).getByText("New driver")).toBeTruthy();
  });

  it("deletes through the row menu and confirmation", async () => {
    render(<CrewPage />);
    rowMenu("Actions for Amina Okoye", "Delete");
    expect(screen.getByText("Delete Amina Okoye? This cannot be undone.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    });
    expect(state.removeDriver).toHaveBeenCalledWith({ driverId: "drv-1", expectedVersion: 1 });
    expect(state.toastSuccess).toHaveBeenCalledWith("Driver DRV-001 deleted.");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an empty state per kind with the kind's add action", () => {
    state.lists = { vehicle: [], driver: [], operator: [] };
    state.query.tab = "operator";
    render(<CrewPage />);
    expect(screen.getByText("No operators yet")).toBeTruthy();
    fireEvent.click(tab(/^Drivers/));
    expect(screen.getByText("No drivers yet")).toBeTruthy();
    expect(screen.getByText("Drivers are named on deliveries.")).toBeTruthy();
    // The empty-state action is not a copy of the header button.
    expect(screen.getByRole("button", { name: "Create your first driver" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New driver" })).toHaveLength(1);
  });
});

describe("VehiclesPage", () => {
  it("shows the vehicles table alone, with no tab bar", () => {
    render(<VehiclesPage />);
    expect(screen.getByRole("heading", { name: "Vehicles" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("table", { name: "Vehicles" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New vehicle" })).toBeTruthy();
  });

  it("opens the create sheet from the header button and from a create link", () => {
    render(<VehiclesPage />);
    expect(screen.queryByText("Create vehicle")).toBeNull();
    act(() => state.openCreate!());
    expect(screen.getByText("Create vehicle")).toBeTruthy();
    expect(screen.getByRole("form", { name: "vehicle form" }).textContent).toBe("new");
  });

  it("edits from the row menu", () => {
    render(<VehiclesPage />);
    rowMenu("Actions for Feedstock truck", "Edit");
    expect(screen.getByRole("form", { name: "vehicle form" }).textContent).toBe("editing Feedstock truck");
  });

  it("links each row to its record", () => {
    render(<VehiclesPage />);
    expect(screen.getAllByRole("link", { name: "Feedstock truck" })[0]!.getAttribute("href")).toBe(
      "/vehicles?vehicle=veh-1",
    );
  });

  it("opens the view sheet for ?vehicle= and clears the link on close", () => {
    state.query = { vehicle: "veh-1" };
    render(<VehiclesPage />);
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("Feedstock truck")).toBeTruthy();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(state.query.vehicle).toBeNull();
  });

  it("opens the edit sheet for mode=edit", () => {
    state.query = { vehicle: "veh-1", mode: "edit" };
    render(<VehiclesPage />);
    expect(screen.getByRole("form", { name: "vehicle form" }).textContent).toBe("editing Feedstock truck");
  });

  it("gives way to the in-use dialog when the server refuses the delete", async () => {
    const message = "Vehicle VEH-001 was not deleted because 2 feedstock intakes use it.";
    state.removeVehicle.mockRejectedValueOnce(new ActionError({ error: message, ...inUseDeleteRefusal(message, ["vehicleId"]) }));
    render(<VehiclesPage />);
    rowMenu("Actions for Feedstock truck", "Delete");
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Vehicle VEH-001 is in use")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Archive instead/ })).toBeNull();
    expect(within(dialog).getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    expect(state.toastError).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retries a stale delete with the version the list refreshed to", async () => {
    state.removeVehicle.mockRejectedValueOnce(
      new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "vehicle", id: vehicle.id, code: STALE_VERSION_CONFLICT_CODE }),
    );
    const { rerender } = render(<VehiclesPage />);
    rowMenu("Actions for Feedstock truck", "Delete");
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    });
    expect(screen.getByRole("dialog").textContent).toContain("Vehicle VEH-001 was not deleted. It changed since the list loaded.");

    // The mutation's invalidation refetches the list with the newer version.
    state.lists.vehicle = [{ ...vehicle, version: 2 }];
    rerender(<VehiclesPage />);
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    });
    expect(state.removeVehicle).toHaveBeenLastCalledWith({ vehicleId: "veh-1", expectedVersion: 2 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
