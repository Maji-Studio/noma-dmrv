// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupplierWithRelations } from "@/data-access/suppliers";
import { SupplierList } from "./supplier-list";

const state = vi.hoisted(() => ({
  stats: { data: undefined as unknown, isLoading: false, isError: false },
  statsArchivedArgs: [] as boolean[],
  filters: [] as Array<{ archived?: boolean }>,
  items: [] as unknown[],
  archive: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  query: {} as Record<string, string | null>,
  linked: null as unknown,
  fetchSupplier: vi.fn(),
  error: vi.fn(),
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [state.query[key] ?? null, vi.fn()],
}));
vi.mock("@/hooks/use-suppliers", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useSupplierStats: (archived: boolean) => {
      state.statsArchivedArgs.push(archived);
      return state.stats;
    },
    useSuppliers: (filters: { archived?: boolean }) => {
      state.filters.push(filters);
      const items = state.items.filter((item) => Boolean((item as SupplierWithRelations).archivedAt) === Boolean(filters.archived));
      return { data: { items, total: items.length, totalPages: 1 }, isLoading: false, error: null };
    },
    useSupplier: () => ({ data: state.linked, isLoading: false, isFetching: false, isPending: false, isSuccess: true, isError: false }),
    useFetchSupplier: () => state.fetchSupplier,
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
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: state.success, error: state.error }) }));
vi.mock("@/components/forms", () => ({ ServerError: ({ message }: { message: string }) => <p role="alert">{message}</p> }));
vi.mock("./supplier-form", () => ({ SupplierForm: () => null }));
vi.mock("./supplier-read-sections", () => ({ supplierSheetSections: () => [] }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? <button type="button" onClick={onConfirm}>Confirm delete</button> : null,
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ open, mode, canEdit = true, viewModeNotice, onModeChange, onOpenChange }: { open: boolean; mode: string; canEdit?: boolean; viewModeNotice?: ReactNode; onModeChange?: (mode: string) => void; onOpenChange?: (open: boolean) => void }) =>
    open ? <aside aria-label="Sheet" data-mode={mode}>{viewModeNotice}<button type="button" onClick={() => onOpenChange?.(false)}>Close sheet</button><button type="button" onClick={() => onModeChange?.("edit")}>Request edit mode</button>{canEdit && <button type="button">Edit supplier</button>}</aside> : null,
}));
vi.mock("@/components/ui/stat-card", () => ({
  StatCard: ({ title, value, description, isError }: { title: string; value: ReactNode; description?: string; isError?: boolean }) => (
    <section aria-label={title}>{isError ? "Could not load" : value}<small>{description}</small></section>
  ),
}));
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
  state.statsArchivedArgs = [];
  state.filters = [];
  state.items = [];
});
afterEach(cleanup);

describe("SupplierList summary card", () => {
  it("shows the server total without page wording", () => {
    state.stats = { data: { totalSuppliers: 42 }, isLoading: false, isError: false };
    render(<SupplierList />);

    const card = screen.getByLabelText("Active suppliers");
    expect(card.textContent).toContain("42");
    expect(document.body.textContent).not.toContain("on this page");
  });

  it("keeps the archived toggle as the card scope", () => {
    state.stats = { data: { totalSuppliers: 3 }, isLoading: false, isError: false };
    render(<SupplierList />);
    expect(state.statsArchivedArgs.at(-1)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(state.statsArchivedArgs.at(-1)).toBe(true);

    const card = screen.getByLabelText("Archived suppliers");
    expect(card.textContent).toContain("3");
  });

  it("shows the failure, not zero, when the total could not load", () => {
    state.stats = { data: undefined, isLoading: false, isError: true };
    render(<SupplierList />);

    expect(screen.getByLabelText("Active suppliers").textContent).toContain("Could not load");
  });
});
