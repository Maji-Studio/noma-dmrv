// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CascadeChangedError } from "@/lib/cascade-changed";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerWithRelations } from "@/data-access/customers";
import { CustomerList } from "./customer-list";

const state = vi.hoisted(() => ({
  filters: [] as Array<{ archived?: boolean }>,
  items: [] as unknown[],
  archive: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  query: {} as Record<string, string | null>,
  linked: null as unknown,
  preview: { data: undefined as unknown, error: null as Error | null, isPending: false, isError: false },
  removeVariables: [] as unknown[],
}));

const OPEN_CASCADE = { orders: [{ id: "o1", code: "ORD-0001" }], cascadeFingerprint: "v1:open" };

function customer(code: string, archivedAt: Date | null): CustomerWithRelations {
  return {
    id: `id-${code}`, code, name: `E2E Customer ${code}`, version: 4, archivedAt, cropType: null, locationCount: 0, locations: [],
  } as unknown as CustomerWithRelations;
}

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [state.query[key] ?? null, vi.fn()],
}));
vi.mock("@/hooks/use-customers", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useCustomers: (filters: { archived?: boolean }) => {
      state.filters.push(filters);
      const items = state.items.filter((item) => Boolean((item as CustomerWithRelations).archivedAt) === Boolean(filters.archived));
      return { data: { items, total: items.length, totalPages: 1 }, isLoading: false, error: null };
    },
    useCustomerWithRelations: () => ({ data: state.linked, isLoading: false, isFetching: false, isPending: false, isSuccess: true, isError: false }),
    useCustomerLocations: () => ({ data: [], isLoading: false }),
    useCreateCustomerWithLocations: mutation,
    useUpdateCustomer: mutation,
    useCustomerDeletePreview: () => state.preview,
    useDeleteCustomer: () => ({ mutateAsync: state.remove, isPending: false }),
    useArchiveCustomer: () => ({ mutateAsync: state.archive, isPending: false }),
    useRestoreCustomer: () => ({ mutateAsync: state.restore, isPending: false }),
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
vi.mock("./customer-form", () => ({ CustomerForm: () => null }));
vi.mock("./customer-read-sections", () => ({ customerSheetSections: () => [] }));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 0 }, CustomerArt: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ isOpen, onConfirm, children, errorMessage }: { isOpen: boolean; onConfirm: () => void; children?: ReactNode; errorMessage?: string }) =>
    isOpen ? <div role="dialog">{children}{errorMessage && <p role="alert">{errorMessage}</p>}<button type="button" onClick={onConfirm}>Confirm delete</button></div> : null,
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ open, mode, canEdit = true, viewModeNotice, onModeChange }: { open: boolean; mode: string; canEdit?: boolean; viewModeNotice?: ReactNode; onModeChange?: (mode: string) => void }) =>
    open ? <aside aria-label="Sheet" data-mode={mode}>{viewModeNotice}<button type="button" onClick={() => onModeChange?.("edit")}>Request edit mode</button>{canEdit && <button type="button">Edit customer</button>}</aside> : null,
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
  state.remove.mockReset().mockResolvedValue({ cascade: OPEN_CASCADE, warnings: [] });
  state.preview = { data: { cascade: OPEN_CASCADE }, error: null, isPending: false, isError: false };
  state.success.mockReset();
  state.items = [customer("CUST-0001", null), customer("CUST-0002", new Date("2026-01-01"))];
});
afterEach(cleanup);

function menu(label: string): string[] {
  return Array.from(screen.getByRole("list", { name: label }).querySelectorAll("li")).map((item) => item.textContent ?? "");
}

describe("CustomerList archive view", () => {
  it("toggles between the active and archived server filters", () => {
    render(<CustomerList />);
    const toggle = screen.getByRole("button", { name: "Archived" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Active customers")).toBeTruthy();
    expect(state.filters.at(-1)?.archived).toBe(false);

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Archived" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Archived customers")).toBeTruthy();
    expect(state.filters.at(-1)?.archived).toBe(true);
  });

  it("offers Edit and Archive on active rows, Restore and no Edit on archived rows", () => {
    render(<CustomerList />);
    expect(menu("Actions for CUST-0001")).toEqual(["Open details", "Edit", "Archive", "Delete"]);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(menu("Actions for CUST-0002")).toEqual(["Open details", "Restore", "Delete"]);
  });

  it("explains an empty archived view", () => {
    state.items = [customer("CUST-0001", null)];
    render(<CustomerList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.getByText("No archived customers")).toBeTruthy();
    expect(screen.getByText("Customers you archive will appear here and can be restored.")).toBeTruthy();
  });

  it("archives with the row version and confirms with the restore hint", async () => {
    render(<CustomerList />);
    fireEvent.click(within("Actions for CUST-0001", "Archive"));
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith({ customerId: "id-CUST-0001", expectedVersion: 4 }));
    expect(state.success).toHaveBeenCalledWith("Customer CUST-0001 archived. Restore it from the archived view.");
  });

  it("shows a stale archive refusal as a message", async () => {
    state.archive.mockRejectedValue(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "customer", id: "id-CUST-0001", code: STALE_VERSION_CONFLICT_CODE }));
    render(<CustomerList />);
    fireEvent.click(within("Actions for CUST-0001", "Archive"));
    expect((await screen.findByRole("alert")).textContent).toBe("Customer CUST-0001 was not archived. It changed since the list loaded. Review it before archiving.");
  });

  it("offers Archive instead when a delete is refused because records use the customer", async () => {
    state.remove.mockRejectedValue(new Error("Customer was not deleted because orders still use it. Open Orders and review them. Reassign them where appropriate, or keep this customer."));
    render(<CustomerList />);
    fireEvent.click(within("Actions for CUST-0001", "Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByText("CUST-0001 is in use and cannot be deleted.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    await waitFor(() => expect(state.archive).toHaveBeenCalledWith({ customerId: "id-CUST-0001", expectedVersion: 4 }));
    await waitFor(() => expect(screen.queryByText("CUST-0001 is in use and cannot be deleted.")).toBeNull());
  });

  it("retries Archive instead with the refreshed version after a stale refusal", async () => {
    state.remove.mockRejectedValue(new Error("Customer was not deleted because orders still use it. Open Orders and review them. Reassign them where appropriate, or keep this customer."));
    state.archive.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "customer", id: "id-CUST-0001", code: STALE_VERSION_CONFLICT_CODE })).mockResolvedValue(undefined);
    const view = render(<CustomerList />);
    fireEvent.click(within("Actions for CUST-0001", "Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("CUST-0001 is in use and cannot be deleted.");
    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    await waitFor(() => expect(state.archive).toHaveBeenLastCalledWith({ customerId: "id-CUST-0001", expectedVersion: 4 }));
    await screen.findByRole("alert");

    state.items = state.items.map((item) => ({ ...(item as object), version: 5 }));
    view.rerender(<CustomerList />);
    fireEvent.click(screen.getByRole("button", { name: "Archive instead" }));
    await waitFor(() => expect(state.archive).toHaveBeenLastCalledWith({ customerId: "id-CUST-0001", expectedVersion: 5 }));
  });

  it("retries Restore from the archived sheet with the refreshed version after a stale refusal", async () => {
    state.restore.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "customer", id: "id-CUST-0002", code: STALE_VERSION_CONFLICT_CODE })).mockResolvedValue(undefined);
    const view = render(<CustomerList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(within("Actions for CUST-0002", "Open details"));
    fireEvent.click(buttonIn(screen.getByLabelText("Sheet"), "Restore"));
    await waitFor(() => expect(state.restore).toHaveBeenLastCalledWith({ customerId: "id-CUST-0002", expectedVersion: 4 }));
    await screen.findByRole("alert");

    state.items = state.items.map((item) => ({ ...(item as object), version: 5 }));
    view.rerender(<CustomerList />);
    fireEvent.click(buttonIn(screen.getByLabelText("Sheet"), "Restore"));
    await waitFor(() => expect(state.restore).toHaveBeenLastCalledWith({ customerId: "id-CUST-0002", expectedVersion: 5 }));
  });

  it("lists the orders that go with the customer and sends the fingerprint with the delete", async () => {
    state.preview = { ...state.preview, data: { cascade: { orders: Array.from({ length: 7 }, (_, index) => ({ id: `o${index}`, code: `ORD-000${index + 1}` })), cascadeFingerprint: "v1:seven" } } };
    render(<CustomerList />);
    fireEvent.click(within("Actions for CUST-0001", "Delete"));
    expect(screen.getByText("These 7 orders have no deliveries and are deleted too:")).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toContain("ORD-0005");
    expect(items).not.toContain("ORD-0006");
    expect(items).toContain("and 2 more");

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith({ customerId: "id-CUST-0001", expectedVersion: 4, cascadeFingerprint: "v1:seven" }));
    expect(state.success).toHaveBeenCalledWith("Customer deleted.");
  });

  it("offers Archive instead as soon as the dry run refuses a customer that has deliveries", () => {
    state.preview = { data: undefined, isPending: false, isError: true, error: new Error("Customer was not deleted because deliveries were recorded on its orders. Archive it instead.") };
    render(<CustomerList />);
    fireEvent.click(within("Actions for CUST-0001", "Delete"));
    expect(screen.getByText("CUST-0001 is in use and cannot be deleted.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Archive instead" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
  });

  it("shows the changed order list and asks again instead of deleting silently", async () => {
    const fresh = { orders: [{ id: "o1", code: "ORD-0001" }, { id: "o2", code: "ORD-0002" }], cascadeFingerprint: "v1:fresh" };
    state.remove.mockRejectedValueOnce(new CascadeChangedError("The orders this delete would remove changed since the preview. Review them and confirm again.", fresh)).mockResolvedValue({ cascade: fresh, warnings: [] });
    render(<CustomerList />);
    fireEvent.click(within("Actions for CUST-0001", "Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.remove).toHaveBeenLastCalledWith({ customerId: "id-CUST-0001", expectedVersion: 4, cascadeFingerprint: "v1:open" }));
    expect(await screen.findByText("The orders deleted with this customer changed. Review the list and delete again.")).toBeTruthy();
    expect(screen.getByText("These 2 orders have no deliveries and are deleted too:")).toBeTruthy();
    expect(screen.getByText("ORD-0002")).toBeTruthy();
    expect(state.success).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.remove).toHaveBeenLastCalledWith({ customerId: "id-CUST-0001", expectedVersion: 4, cascadeFingerprint: "v1:fresh" }));
    expect(state.success).toHaveBeenCalledWith("Customer deleted.");
  });

  it("self-heals a deep-linked archived sheet after a stale Restore, because the sheet reads the live detail", async () => {
    state.query = { customer: "id-CUST-0002" };
    state.linked = customer("CUST-0002", new Date("2026-01-01"));
    state.restore.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "customer", id: "id-CUST-0002", code: STALE_VERSION_CONFLICT_CODE })).mockResolvedValue(undefined);
    const view = render(<CustomerList />);
    fireEvent.click(buttonIn(screen.getByLabelText("Sheet"), "Restore"));
    await waitFor(() => expect(state.restore).toHaveBeenLastCalledWith({ customerId: "id-CUST-0002", expectedVersion: 4 }));
    await screen.findByRole("alert");

    // The refused save refetched the detail query: the sheet now holds the current version.
    state.linked = { ...(state.linked as object), version: 5 };
    view.rerender(<CustomerList />);
    fireEvent.click(buttonIn(screen.getByLabelText("Sheet"), "Restore"));
    await waitFor(() => expect(state.restore).toHaveBeenLastCalledWith({ customerId: "id-CUST-0002", expectedVersion: 5 }));
  });

  it("does not offer Archive instead when an already archived customer is refused as in use", async () => {
    state.remove.mockRejectedValue(new Error("Customer was not deleted because orders still use it. Open Orders and review them. Reassign them where appropriate, or keep this customer."));
    render(<CustomerList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(within("Actions for CUST-0002", "Delete"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(state.remove).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
    expect(screen.queryByText(/is in use and cannot be deleted/)).toBeNull();
  });

  it("refuses the edit mode request on an archived customer and allows it on an active one", () => {
    render(<CustomerList />);
    fireEvent.click(within("Actions for CUST-0001", "Open details"));
    fireEvent.click(screen.getByRole("button", { name: "Request edit mode" }));
    expect(screen.getByLabelText("Sheet").getAttribute("data-mode")).toBe("edit");
    cleanup();

    render(<CustomerList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(within("Actions for CUST-0002", "Open details"));
    fireEvent.click(screen.getByRole("button", { name: "Request edit mode" }));
    expect(screen.getByLabelText("Sheet").getAttribute("data-mode")).toBe("view");
  });

  it("opens an archived customer read-only with the notice and Restore", async () => {
    render(<CustomerList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(within("Actions for CUST-0002", "Open details"));
    const sheet = screen.getByLabelText("Sheet");
    expect(sheet.getAttribute("data-mode")).toBe("view");
    expect(screen.getByText("This customer is archived. Pickers hide it and new orders cannot use it. Existing orders keep it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit customer" })).toBeNull();

    fireEvent.click(buttonIn(sheet, "Restore"));
    await waitFor(() => expect(state.restore).toHaveBeenCalledWith({ customerId: "id-CUST-0002", expectedVersion: 4 }));
    expect(state.success).toHaveBeenCalledWith("Customer CUST-0002 restored.");
  });

  it("keeps an archived customer in view mode when a deep link asks for edit", () => {
    state.query = { customer: "id-CUST-0002", mode: "edit" };
    state.linked = customer("CUST-0002", new Date("2026-01-01"));
    render(<CustomerList />);
    expect(screen.getByLabelText("Sheet").getAttribute("data-mode")).toBe("view");
    expect(screen.queryByRole("button", { name: "Edit customer" })).toBeNull();
  });

  it("shows Edit on an active customer sheet", () => {
    render(<CustomerList />);
    fireEvent.click(within("Actions for CUST-0001", "Open details"));
    expect(screen.getByRole("button", { name: "Edit customer" })).toBeTruthy();
  });
});

function within(label: string, action: string): HTMLElement {
  const list = screen.getByRole("list", { name: label });
  return Array.from(list.querySelectorAll("button")).find((button) => button.textContent === action) as HTMLElement;
}

function buttonIn(root: HTMLElement, name: string): HTMLElement {
  return Array.from(root.querySelectorAll("button")).find((button) => button.textContent === name) as HTMLElement;
}
