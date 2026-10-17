// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierWithRelations } from "@/data-access/suppliers";
import { SupplierList } from "./supplier-list";

const state = vi.hoisted(() => ({
  filters: [] as Array<{ archived?: boolean }>,
  items: [] as unknown[],
  archive: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  query: {} as Record<string, string | null>,
  linked: null as unknown,
}));

function supplier(code: string, archivedAt: Date | null): SupplierWithRelations {
  return {
    id: `id-${code}`, code, name: `E2E Supplier ${code}`, version: 4, archivedAt, location: null, contactName: null,
    contactEmail: null, defaultLocationDisplay: null,
  } as unknown as SupplierWithRelations;
}

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [state.query[key] ?? null, vi.fn()],
}));
vi.mock("@/hooks/use-suppliers", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useSuppliers: (filters: { archived?: boolean }) => {
      state.filters.push(filters);
      const items = state.items.filter((item) => Boolean((item as SupplierWithRelations).archivedAt) === Boolean(filters.archived));
      return { data: { items, total: items.length, totalPages: 1 }, isLoading: false, error: null };
    },
    useSupplier: () => ({ data: state.linked, isLoading: false, isFetching: false, isPending: false, isSuccess: true, isError: false }),
    useSupplierLocationsBySupplier: () => ({ data: [], isLoading: false }),
    useCreateSupplierWithLocations: mutation,
    useUpdateSupplier: mutation,
    useDeleteSupplier: () => ({ mutateAsync: state.remove, isPending: false }),
    useArchiveSupplier: () => ({ mutateAsync: state.archive, isPending: false }),
    useRestoreSupplier: () => ({ mutateAsync: state.restore, isPending: false }),
  };
});
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: state.success, error: vi.fn() }) }));
vi.mock("@/components/forms", () => ({ ServerError: ({ message }: { message: string }) => <p role="alert">{message}</p> }));
vi.mock("./supplier-form", () => ({ SupplierForm: () => null }));
vi.mock("./supplier-read-sections", () => ({ supplierSheetSections: () => [] }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? <button type="button" onClick={onConfirm}>Confirm delete</button> : null,
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ open, mode, canEdit = true, viewModeNotice, onModeChange }: { open: boolean; mode: string; canEdit?: boolean; viewModeNotice?: ReactNode; onModeChange?: (mode: string) => void }) =>
    open ? <aside aria-label="Sheet" data-mode={mode}>{viewModeNotice}<button type="button" onClick={() => onModeChange?.("edit")}>Request edit mode</button>{canEdit && <button type="button">Edit supplier</button>}</aside> : null,
}));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: ({ title }: { title: string }) => <section>{title}</section> }));
vi.mock("@/components/ui", () => ({
  Button: ({ children, onClick, ...props }: { children?: ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <button type="button" onClick={onClick} aria-pressed={props["aria-pressed"] as boolean | undefined}>{children}</button>
  ),
  EmptyState: ({ title, description }: { title: string; description: string }) => <section><h2>{title}</h2><p>{description}</p></section>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  RowActionsMenu: ({ label, actions }: { label: string; actions: Array<{ label: string; onSelect: () => void }> }) => (
    <ul aria-label={label}>{actions.map((action) => <li key={action.label}><button type="button" onClick={action.onSelect}>{action.label}</button></li>)}</ul>
  ),
}));
vi.mock("@/components/ui/data-table", () => {
  const Slot = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DataTable: Object.assign(
      ({ columns, data, emptyMessage, children }: { columns: Array<Record<string, unknown>>; data: unknown[]; emptyMessage: ReactNode; children: ReactNode }) => (
        <div>
          {children}
          {data.length === 0 && emptyMessage}
          {data.map((item) => (
            <div key={(item as { id: string }).id}>
              {columns.map((column, index) => {
                const cell = column.cell as ((ctx: { row: { original: unknown } }) => ReactNode) | undefined;
                return <div key={index}>{cell?.({ row: { original: item } })}</div>;
              })}
            </div>
          ))}
        </div>
      ),
      { Toolbar: Slot, Controls: Slot, Search: () => null, ColumnVisibility: () => null, Pagination: () => null },
    ),
  };
});

beforeEach(() => {
  state.filters = [];
  state.query = {};
  state.linked = null;
  state.archive.mockReset().mockResolvedValue(undefined);
  state.restore.mockReset().mockResolvedValue(undefined);
  state.remove.mockReset().mockResolvedValue(undefined);
  state.success.mockReset();
  state.items = [supplier("SUP-0001", null), supplier("SUP-0002", new Date("2026-01-01"))];
});
afterEach(cleanup);

function menu(label: string): string[] {
  return Array.from(screen.getByRole("list", { name: label }).querySelectorAll("li")).map((item) => item.textContent ?? "");
}

describe("SupplierList archive view", () => {
  it("toggles between the active and archived server filters", () => {
    render(<SupplierList />);
    const toggle = screen.getByRole("button", { name: "Archived" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Active suppliers")).toBeTruthy();
    expect(state.filters.at(-1)?.archived).toBe(false);

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Archived" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Archived suppliers")).toBeTruthy();
    expect(state.filters.at(-1)?.archived).toBe(true);
  });

  it("offers Edit and Archive on active rows, Restore and no Edit on archived rows", () => {
    render(<SupplierList />);
    expect(menu("Actions for SUP-0001")).toEqual(["Open details", "Edit", "Archive", "Delete"]);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(menu("Actions for SUP-0002")).toEqual(["Open details", "Restore", "Delete"]);
  });

  it("explains an empty archived view", () => {
    state.items = [supplier("SUP-0001", null)];
    render(<SupplierList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.getByText("No archived suppliers")).toBeTruthy();
    expect(screen.getByText("Suppliers you archive will appear here and can be restored.")).toBeTruthy();
  });

  it("archives with the row version and confirms with the restore hint", async () => {
    render(<SupplierList />);
    fireEvent.click(within("Actions for SUP-0001", "Archive"));
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith({ supplierId: "id-SUP-0001", expectedVersion: 4 }));
    expect(state.success).toHaveBeenCalledWith("Supplier SUP-0001 archived. Restore it from the archived view.");
  });

  it("shows a stale archive refusal as a message", async () => {
    state.archive.mockRejectedValue(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "supplier", id: "id-SUP-0001", code: STALE_VERSION_CONFLICT_CODE }));
    render(<SupplierList />);
    fireEvent.click(within("Actions for SUP-0001", "Archive"));
    expect((await screen.findByRole("alert")).textContent).toBe("Supplier SUP-0001 was not archived. It changed since the list loaded. Review it before archiving.");
  });

  it("offers Archive instead when a delete is refused because records use the supplier", async () => {
    state.remove.mockRejectedValue(new Error("Supplier was not deleted because feedstock intakes still use it. Review the linked intakes or keep this supplier."));
    render(<SupplierList />);
    fireEvent.click(within("Actions for SUP-0001", "Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByText("SUP-0001 is in use and cannot be deleted.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith({ supplierId: "id-SUP-0001", expectedVersion: 4 }));
    await waitFor(() => expect(screen.queryByText("SUP-0001 is in use and cannot be deleted.")).toBeNull());
  });

  it("retries Archive instead with the refreshed version after a stale refusal", async () => {
    state.remove.mockRejectedValue(new Error("Supplier was not deleted because feedstock intakes still use it. Review the linked intakes or keep this supplier."));
    state.archive.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "supplier", id: "id-SUP-0001", code: STALE_VERSION_CONFLICT_CODE })).mockResolvedValue(undefined);
    const view = render(<SupplierList />);
    fireEvent.click(within("Actions for SUP-0001", "Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("SUP-0001 is in use and cannot be deleted.");
    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    await waitFor(() => expect(state.archive).toHaveBeenLastCalledWith({ supplierId: "id-SUP-0001", expectedVersion: 4 }));
    await screen.findByRole("alert");

    state.items = state.items.map((item) => ({ ...(item as object), version: 5 }));
    view.rerender(<SupplierList />);
    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    await waitFor(() => expect(state.archive).toHaveBeenLastCalledWith({ supplierId: "id-SUP-0001", expectedVersion: 5 }));
  });

  it("retries Restore from the archived sheet with the refreshed version after a stale refusal", async () => {
    state.restore.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "supplier", id: "id-SUP-0002", code: STALE_VERSION_CONFLICT_CODE })).mockResolvedValue(undefined);
    const view = render(<SupplierList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(within("Actions for SUP-0002", "Open details"));
    fireEvent.click(buttonIn(screen.getByLabelText("Sheet"), "Restore"));
    await waitFor(() => expect(state.restore).toHaveBeenLastCalledWith({ supplierId: "id-SUP-0002", expectedVersion: 4 }));
    await screen.findByRole("alert");

    state.items = state.items.map((item) => ({ ...(item as object), version: 5 }));
    view.rerender(<SupplierList />);
    fireEvent.click(buttonIn(screen.getByLabelText("Sheet"), "Restore"));
    await waitFor(() => expect(state.restore).toHaveBeenLastCalledWith({ supplierId: "id-SUP-0002", expectedVersion: 5 }));
  });

  it("does not offer Archive instead when an already archived supplier is refused as in use", async () => {
    state.remove.mockRejectedValue(new Error("Supplier was not deleted because feedstock intakes still use it. Review the linked intakes or keep this supplier."));
    render(<SupplierList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(within("Actions for SUP-0002", "Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.remove).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
    expect(screen.queryByText(/is in use and cannot be deleted/)).toBeNull();
  });

  it("refuses the edit mode request on an archived supplier and allows it on an active one", () => {
    render(<SupplierList />);
    fireEvent.click(within("Actions for SUP-0001", "Open details"));
    fireEvent.click(screen.getByRole("button", { name: "Request edit mode" }));
    expect(screen.getByLabelText("Sheet").getAttribute("data-mode")).toBe("edit");
    cleanup();

    render(<SupplierList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(within("Actions for SUP-0002", "Open details"));
    fireEvent.click(screen.getByRole("button", { name: "Request edit mode" }));
    expect(screen.getByLabelText("Sheet").getAttribute("data-mode")).toBe("view");
  });

  it("opens an archived supplier read-only with the notice and Restore", async () => {
    render(<SupplierList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(within("Actions for SUP-0002", "Open details"));
    const sheet = screen.getByLabelText("Sheet");
    expect(sheet.getAttribute("data-mode")).toBe("view");
    expect(screen.getByText("This supplier is archived. Pickers hide it and new intakes cannot use it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit supplier" })).toBeNull();

    fireEvent.click(buttonIn(sheet, "Restore"));
    await waitFor(() => expect(state.restore).toHaveBeenCalledWith({ supplierId: "id-SUP-0002", expectedVersion: 4 }));
    expect(state.success).toHaveBeenCalledWith("Supplier SUP-0002 restored.");
  });

  it("keeps an archived supplier in view mode when a deep link asks for edit", () => {
    state.query = { supplier: "id-SUP-0002", mode: "edit" };
    state.linked = supplier("SUP-0002", new Date("2026-01-01"));
    render(<SupplierList />);
    expect(screen.getByLabelText("Sheet").getAttribute("data-mode")).toBe("view");
    expect(screen.queryByRole("button", { name: "Edit supplier" })).toBeNull();
  });

  it("shows Edit on an active supplier sheet", () => {
    render(<SupplierList />);
    fireEvent.click(within("Actions for SUP-0001", "Open details"));
    expect(screen.getByRole("button", { name: "Edit supplier" })).toBeTruthy();
  });
});

function within(label: string, action: string): HTMLElement {
  const list = screen.getByRole("list", { name: label });
  return Array.from(list.querySelectorAll("button")).find((button) => button.textContent === action) as HTMLElement;
}

function buttonIn(root: HTMLElement, name: string): HTMLElement {
  return Array.from(root.querySelectorAll("button")).find((button) => button.textContent === name) as HTMLElement;
}
