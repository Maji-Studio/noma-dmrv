// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";
import { CustomerSavedLocations } from "./customer-saved-locations";

const state = vi.hoisted(() => ({
  locations: [] as unknown[],
  archive: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  intent: null as string | null,
  editor: vi.fn(),
}));

vi.mock("nuqs", () => ({ useQueryState: () => [state.intent, vi.fn()] }));
vi.mock("@/hooks/use-customers", () => ({
  useCustomerLocations: () => ({ data: state.locations, isLoading: false, isError: false }),
  useArchiveCustomerLocation: () => ({ mutateAsync: state.archive, isPending: false }),
  useRestoreCustomerLocation: () => ({ mutateAsync: state.restore, isPending: false }),
  useDeleteCustomerLocation: () => ({ mutateAsync: state.remove, isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: state.success, warning: state.warning, error: state.error }) }));
vi.mock("./customer-location-dialog", () => ({
  CustomerLocationDialog: ({ isOpen, location }: { isOpen: boolean; location?: { name: string } }) => {
    if (isOpen) state.editor(location?.name);
    return null;
  },
}));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void; children?: ReactNode }) =>
    isOpen ? <button type="button" onClick={onConfirm}>Confirm delete</button> : null,
}));

const ARCHIVED_AT = new Date("2026-02-01");

function location(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, country: "Tanzania", stateRegion: null, city: null, address: null, gpsLatitude: -6.9, gpsLongitude: 39.3,
    facilityDistances: [], defaultSoilTemperatureC: null, isDefault: false, version: 3, updatedAt: new Date(), archivedAt: null, ...extra,
  };
}

const IN_USE = "Customer location was not deleted because orders use it. Archive it instead.";

beforeEach(() => {
  state.intent = null;
  state.locations = [location("l1", "E2E North Block", { isDefault: true }), location("l2", "E2E South Block")];
  state.archive.mockReset().mockResolvedValue({ warnings: [] });
  state.restore.mockReset().mockResolvedValue({ warnings: [] });
  state.remove.mockReset().mockResolvedValue({ warnings: [] });
  state.success.mockReset();
  state.warning.mockReset();
  state.error.mockReset();
  state.editor.mockReset();
});
afterEach(cleanup);

describe("CustomerSavedLocations", () => {
  it("lists active locations first and archived ones in their own muted, read-only group", () => {
    state.locations = [location("l3", "E2E Old Field", { archivedAt: ARCHIVED_AT }), ...state.locations];
    render(<CustomerSavedLocations customerId="c1" />);

    const archivedGroup = screen.getByRole("group", { name: "Archived locations" });
    expect(within(archivedGroup).getByText("E2E Old Field")).toBeTruthy();
    expect(within(archivedGroup).getByRole("button", { name: "Restore E2E Old Field" })).toBeTruthy();
    expect(within(archivedGroup).getByRole("button", { name: "Delete E2E Old Field" })).toBeTruthy();
    expect(within(archivedGroup).queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(within(archivedGroup).queryByRole("button", { name: /^Archive / })).toBeNull();

    expect(screen.getByRole("button", { name: "Edit E2E North Block" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive E2E North Block" })).toBeTruthy();
    // Document order: the active rows come before the archived group.
    const text = document.body.textContent ?? "";
    expect(text.indexOf("E2E South Block")).toBeLessThan(text.indexOf("Archived locations"));
  });

  it("shows no archived group when nothing is archived", () => {
    render(<CustomerSavedLocations customerId="c1" />);
    expect(screen.queryByRole("group", { name: "Archived locations" })).toBeNull();
  });

  it("disables Archive on the last active location and says why before any click", () => {
    state.locations = [location("l1", "E2E North Block", { isDefault: true }), location("l3", "E2E Old Field", { archivedAt: ARCHIVED_AT })];
    render(<CustomerSavedLocations customerId="c1" />);
    const archive = screen.getByRole("button", { name: "Archive E2E North Block" }) as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    const reason = screen.getByText("This is the only active location, so it cannot be archived. Add or restore another location first.");
    expect(archive.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("archives with the row version, confirms, and shows the default move as a warning", async () => {
    state.archive.mockResolvedValue({ warnings: ["E2E South Block is now the default location."] });
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive E2E North Block" }));
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith({ locationId: "l1", expectedVersion: 3 }));
    expect(state.success).toHaveBeenCalledWith("E2E North Block archived. Restore it from Archived locations.");
    expect(state.warning).toHaveBeenCalledWith("E2E South Block is now the default location.");
  });

  it("restores an archived location and shows its warnings", async () => {
    state.locations = [...state.locations, location("l3", "E2E Old Field", { archivedAt: ARCHIVED_AT })];
    state.restore.mockResolvedValue({ warnings: ["E2E Old Field is now the default location."] });
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Restore E2E Old Field" }));
    await waitFor(() => expect(state.restore).toHaveBeenCalledWith({ locationId: "l3", expectedVersion: 3 }));
    expect(state.success).toHaveBeenCalledWith("E2E Old Field restored.");
    expect(state.warning).toHaveBeenCalledWith("E2E Old Field is now the default location.");
  });

  it("shows a stale archive refusal as a message", async () => {
    state.archive.mockRejectedValue(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "customerLocation", id: "l1", code: STALE_VERSION_CONFLICT_CODE }));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Archive E2E North Block" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Location E2E North Block was not archived. It changed since the list loaded. Review it before archiving.");
  });

  it("offers Archive instead when a delete is refused because orders use the location", async () => {
    state.remove.mockRejectedValue(new Error(IN_USE));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByText("E2E South Block is in use and cannot be deleted.")).toBeTruthy();
    expect(state.error).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith({ locationId: "l2", expectedVersion: 3 }));
    await waitFor(() => expect(screen.queryByText("E2E South Block is in use and cannot be deleted.")).toBeNull());
  });

  it("deletes with the version the operator confirmed, not a newer one from a refetch", async () => {
    const view = render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    state.locations = [location("l1", "E2E North Block", { isDefault: true }), location("l2", "E2E South Block", { version: 4 })];
    view.rerender(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith({ locationId: "l2", expectedVersion: 3 }));
  });

  it("drops the Archive instead notice once its location is the only active one", async () => {
    state.remove.mockRejectedValueOnce(new Error(IN_USE));
    const view = render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("button", { name: "Archive instead" })).toBeTruthy();

    state.locations = [location("l2", "E2E South Block", { isDefault: true })];
    view.rerender(<CustomerSavedLocations customerId="c1" />);
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
  });

  it("does not offer Archive instead for the only active location refused as in use", async () => {
    state.locations = [location("l1", "E2E North Block", { isDefault: true })];
    state.remove.mockRejectedValue(new Error(IN_USE));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E North Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.error).toHaveBeenCalledWith(
      "E2E North Block cannot be deleted because orders use it, and it cannot be archived because it is the only active location. Add another location first, then archive this one.",
    ));
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
  });

  it("does not offer Archive instead for an archived location refused as in use", async () => {
    state.locations = [...state.locations, location("l3", "E2E Old Field", { archivedAt: ARCHIVED_AT })];
    state.remove.mockRejectedValue(new Error(IN_USE));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E Old Field" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.error).toHaveBeenCalledWith(IN_USE));
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
  });

  it("shows the default move after a delete", async () => {
    state.remove.mockResolvedValue({ warnings: ["E2E South Block is now the default location."] });
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E North Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.success).toHaveBeenCalledWith("E2E North Block deleted."));
    expect(state.warning).toHaveBeenCalledWith("E2E South Block is now the default location.");
  });

  it("opens the editor for an active deep-linked location but not for an archived one", () => {
    state.intent = "l2";
    render(<CustomerSavedLocations customerId="c1" />);
    expect(state.editor).toHaveBeenCalledWith("E2E South Block");
    cleanup();

    state.editor.mockReset();
    state.locations = [...state.locations, location("l3", "E2E Old Field", { archivedAt: ARCHIVED_AT })];
    state.intent = "l3";
    render(<CustomerSavedLocations customerId="c1" />);
    expect(state.editor).not.toHaveBeenCalled();
  });
});
