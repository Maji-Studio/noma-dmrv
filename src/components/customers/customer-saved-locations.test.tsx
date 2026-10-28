// @vitest-environment jsdom
import { ActionError } from "@/lib/action-error";
import { inUseDeleteRefusal } from "@/lib/delete-refusal";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";
import { CustomerSavedLocations } from "./customer-saved-locations";

/** Order blockers carry `orderCodes`, as `customerLocationHasOrders` sends them; the storage-site refusal carries none. */
function inUseError(message: string, meta: Record<string, unknown> = { orderCodes: ["ORD-1"] }): ActionError {
  return new ActionError({ error: message, ...inUseDeleteRefusal(message, [], { meta }) });
}

const state = vi.hoisted(() => ({
  locations: [] as unknown[],
  archive: vi.fn(),
  archivePending: false,
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
  useArchiveCustomerLocation: () => ({ mutateAsync: state.archive, isPending: state.archivePending }),
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
  DeleteConfirmDialog: ({ isOpen, onConfirm, message, isPending }: { isOpen: boolean; onConfirm: () => void; message: string; isPending?: boolean; children?: ReactNode }) =>
    isOpen ? (
      <div data-testid="confirm" data-pending={String(!!isPending)}>
        <p>{message}</p>
        <button type="button" onClick={onConfirm}>Confirm delete</button>
      </div>
    ) : null,
}));

const ARCHIVED_AT = new Date("2026-02-01");

function location(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, country: "Tanzania", stateRegion: null, city: null, address: null, gpsLatitude: -6.9, gpsLongitude: 39.3,
    facilityDistances: [], defaultSoilTemperatureC: null, isDefault: false, version: 3, updatedAt: new Date(), archivedAt: null, ...extra,
  };
}

const IN_USE = "Customer location was not deleted because orders use it. Archive it instead.";
const ARCHIVED_IN_USE = "Customer location was not deleted because orders use it.";

beforeEach(() => {
  state.intent = null;
  state.locations = [location("l1", "E2E North Block", { isDefault: true }), location("l2", "E2E South Block")];
  state.archivePending = false;
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
  it("keeps archived locations behind a collapsed toggle labelled with their count", () => {
    state.locations = [location("l3", "E2E Old Field", { archivedAt: ARCHIVED_AT }), ...state.locations];
    render(<CustomerSavedLocations customerId="c1" />);

    const toggle = screen.getByRole("button", { name: "Archived locations (1)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("E2E Old Field")).toBeNull();
    expect(screen.getByRole("button", { name: "About archived locations" }).getAttribute("aria-description")).toBe(
      "Pickers hide these. Existing orders keep them. Restore a location to edit it.",
    );

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const archivedGroup = screen.getByRole("group", { name: "Archived locations" });
    expect(within(archivedGroup).getByText("E2E Old Field")).toBeTruthy();
    expect(within(archivedGroup).getByRole("button", { name: "Restore E2E Old Field" })).toBeTruthy();
    expect(within(archivedGroup).getByRole("button", { name: "Delete E2E Old Field" })).toBeTruthy();
    expect(within(archivedGroup).queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(within(archivedGroup).queryByRole("button", { name: /^Archive / })).toBeNull();
    // Compact rows: no address or coordinates line.
    expect(within(archivedGroup).queryByText(/-6\.9000/)).toBeNull();

    expect(screen.getByRole("button", { name: "Edit E2E North Block" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete E2E North Block" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Archive E2E/ })).toBeNull();
  });

  it("shows no archived toggle when nothing is archived", () => {
    render(<CustomerSavedLocations customerId="c1" />);
    expect(screen.queryByRole("group", { name: "Archived locations" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Archived locations/ })).toBeNull();
  });

  it("restores an archived location and shows its warnings", async () => {
    state.locations = [...state.locations, location("l3", "E2E Old Field", { archivedAt: ARCHIVED_AT })];
    state.restore.mockResolvedValue({ warnings: ["E2E Old Field is now the default location."] });
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Archived locations (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Restore E2E Old Field" }));
    await waitFor(() => expect(state.restore).toHaveBeenCalledWith({ locationId: "l3", expectedVersion: 3 }));
    expect(state.success).toHaveBeenCalledWith("E2E Old Field restored.");
    expect(state.warning).toHaveBeenCalledWith("E2E Old Field is now the default location.");
  });

  it("deletes an unused location and says so", async () => {
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.success).toHaveBeenCalledWith("E2E South Block deleted."));
    expect(state.archive).not.toHaveBeenCalled();
  });

  it("archives a used location when its delete is refused and says which happened", async () => {
    state.remove.mockRejectedValue(inUseError(IN_USE));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith({ locationId: "l2", expectedVersion: 3 }));
    expect(state.success).toHaveBeenCalledWith("E2E South Block is used by orders, so it was archived. Restore it from Archived locations.");
    expect(state.error).not.toHaveBeenCalled();
    expect(screen.queryByText("E2E South Block is in use")).toBeNull();
  });

  it("names a registered storage site as the reason when that refused the delete", async () => {
    state.remove.mockRejectedValue(inUseError("Customer location was not deleted because it is registered with Isometric as a storage site. Archive it instead.", {}));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.success).toHaveBeenCalledWith("E2E South Block is a registered storage site, so it was archived. Restore it from Archived locations."));
  });

  it("archives with the version the operator confirmed, which the refused delete just matched", async () => {
    state.remove.mockRejectedValue(inUseError(IN_USE));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith({ locationId: "l2", expectedVersion: 3 }));
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith({ locationId: "l2", expectedVersion: 3 }));
  });

  it("archives with the confirmed version, not a newer one from a refetch", async () => {
    state.remove.mockRejectedValue(inUseError(IN_USE));
    const view = render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    state.locations = [location("l1", "E2E North Block", { isDefault: true }), location("l2", "E2E South Block", { version: 4 })];
    view.rerender(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith({ locationId: "l2", expectedVersion: 3 }));
  });

  it("keeps the confirm open until the automatic archive settles", async () => {
    state.remove.mockRejectedValue(inUseError(IN_USE));
    let finish: (value: unknown) => void = () => {};
    state.archive.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.archive).toHaveBeenCalled());
    expect(screen.getByTestId("confirm")).toBeTruthy();
    finish({ warnings: [] });
    await waitFor(() => expect(screen.queryByTestId("confirm")).toBeNull());
    expect(state.success).toHaveBeenCalled();
  });

  it("words the confirm by what Delete can do for the row", () => {
    state.locations = [...state.locations, location("l3", "E2E Old Field", { archivedAt: ARCHIVED_AT })];
    const view = render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    expect(screen.getByText(
      "Are you sure you want to delete this location? A location that is in use is archived instead, and you can restore it. A location nothing uses is deleted for good.",
    )).toBeTruthy();
    view.unmount();
    cleanup();

    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Archived locations (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E Old Field" }));
    expect(screen.getByText("Are you sure you want to delete this location? This action cannot be undone.")).toBeTruthy();
    cleanup();

    state.locations = [location("l1", "E2E North Block", { isDefault: true })];
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E North Block" }));
    expect(screen.getByText("Are you sure you want to delete this location? This action cannot be undone.")).toBeTruthy();
  });

  it("shows the archive refusal as an error when the automatic archive fails", async () => {
    state.remove.mockRejectedValue(inUseError(IN_USE));
    state.archive.mockRejectedValue(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "customerLocation", id: "l2", code: STALE_VERSION_CONFLICT_CODE }));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(((await screen.findByRole("alert")).textContent ?? "").replace(/\s+/g, " ").trim()).toContain("E2E South Block was not deleted because it is used by orders, and it could not be archived because it changed since the list loaded. Review it, then delete it again.");
    expect(state.error).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirm")).toBeNull();
  });

  it("gives a doable next step when the automatic archive fails for another reason", async () => {
    state.remove.mockRejectedValue(inUseError("Customer location was not deleted because it is registered with Isometric as a storage site.", {}));
    state.archive.mockRejectedValue(new Error("boom"));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(((await screen.findByRole("alert")).textContent ?? "").replace(/\s+/g, " ").trim()).toContain("E2E South Block was not deleted because it is a registered storage site, and it could not be archived. Try deleting it again.");
    expect(state.error).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the automatic archive is refused", async () => {
    // Another operator archived the sibling after the list loaded, so the server refuses the last active location.
    const LAST_ACTIVE = "E2E South Block is the only active location. Add or restore another location first.";
    state.remove.mockRejectedValue(inUseError(IN_USE));
    state.archive.mockRejectedValue(new ActionError({ error: LAST_ACTIVE, code: "conflict" }));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(((await screen.findByRole("alert")).textContent ?? "").replace(/\s+/g, " ").trim()).toContain(`E2E South Block was not deleted because it is used by orders, and it could not be archived. ${LAST_ACTIVE}`);
  });

  it("deletes with the version the operator confirmed, not a newer one from a refetch", async () => {
    const view = render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E South Block" }));
    state.locations = [location("l1", "E2E North Block", { isDefault: true }), location("l2", "E2E South Block", { version: 4 })];
    view.rerender(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith({ locationId: "l2", expectedVersion: 3 }));
  });

  it("explains instead of archiving the only active location refused as in use", async () => {
    state.locations = [location("l1", "E2E North Block", { isDefault: true })];
    state.remove.mockRejectedValue(inUseError(IN_USE));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E North Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByText("E2E North Block is in use")).toBeTruthy();
    expect(screen.getByText(
      "E2E North Block cannot be deleted because it is used by orders, and it cannot be archived because it is the only active location. Add or restore another location first, then delete this one again to archive it.",
    )).toBeTruthy();
    expect(state.error).not.toHaveBeenCalled();
    expect(state.archive).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    await waitFor(() => expect(screen.queryByText("E2E North Block is in use")).toBeNull());
  });

  it("links every order the refusal names under its own facility", async () => {
    state.locations = [location("l1", "E2E North Block", { isDefault: true })];
    state.remove.mockRejectedValue(inUseError(IN_USE, {
      orderCodes: ["OR-001", "OR-002"],
      orders: [{ id: "o1", code: "OR-001", facilityId: "f1" }, { id: "o2", code: "OR-002", facilityId: "f2" }],
    }));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E North Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    const dialog = within(await screen.findByRole("dialog", { name: "E2E North Block is in use" }));
    expect(dialog.getAllByRole("link").map((link) => [link.getAttribute("aria-label"), link.getAttribute("href")])).toEqual([
      ["Open order OR-001", "/orders?facility=f1&order=o1"], ["Open order OR-002", "/orders?facility=f2&order=o2"],
    ]);
    expect(dialog.getByText(/it cannot be archived because it is the only active location/)).toBeTruthy();
  });

  it("links the orders on an archived location's in-use dialog", async () => {
    state.locations = [...state.locations, location("l3", "E2E Old Field", { archivedAt: ARCHIVED_AT })];
    state.remove.mockRejectedValue(inUseError(ARCHIVED_IN_USE, { orderCodes: ["OR-001"], orders: [{ id: "o1", code: "OR-001", facilityId: "f1" }] }));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Archived locations (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E Old Field" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    const dialog = within(await screen.findByRole("dialog", { name: "E2E Old Field is in use" }));
    expect(dialog.getByText("E2E Old Field cannot be deleted because other records still use it.")).toBeTruthy();
    expect(dialog.getByRole("link", { name: "Open order OR-001" }).getAttribute("href")).toBe("/orders?facility=f1&order=o1");
  });

  it("says only that an archived location is in use when its delete is refused", async () => {
    state.locations = [...state.locations, location("l3", "E2E Old Field", { archivedAt: ARCHIVED_AT })];
    state.remove.mockRejectedValue(inUseError(ARCHIVED_IN_USE));
    render(<CustomerSavedLocations customerId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Archived locations (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete E2E Old Field" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    const dialog = await screen.findByRole("dialog", { name: "E2E Old Field is in use" });
    expect(within(dialog).getByText("E2E Old Field cannot be deleted because other records still use it.")).toBeTruthy();
    expect(within(dialog).queryByText(/archive/i)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Archive instead" })).toBeNull();
    expect(state.error).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" }).find((button) => button.textContent === "Close")!);
    await waitFor(() => expect(screen.queryByText("E2E Old Field is in use")).toBeNull());
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
