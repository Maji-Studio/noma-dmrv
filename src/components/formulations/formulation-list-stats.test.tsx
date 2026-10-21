// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormulationWithIngredients } from "@/data-access/formulations";
import { FormulationList } from "./formulation-list";

const state = vi.hoisted(() => ({
  stats: { data: undefined as unknown, isLoading: false, isError: false },
  filters: [] as Array<{ archived?: boolean }>,
  items: [] as unknown[],
}));

vi.mock("@/hooks/use-formulations", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useFormulationStats: () => state.stats,
    useFormulations: (filters: { archived?: boolean }) => {
      state.filters.push(filters);
      const items = state.items.filter((item) => Boolean((item as FormulationWithIngredients).archivedAt) === Boolean(filters.archived));
      return { data: { items, total: items.length, totalPages: 1 }, isLoading: false, error: null };
    },
    useCreateFormulation: mutation, useUpdateFormulation: mutation, useDeleteFormulation: mutation,
    useArchiveFormulation: mutation, useRestoreFormulation: mutation,
  };
});
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/forms", () => ({ ServerError: ({ message }: { message: string }) => <p role="alert">{message}</p> }));
vi.mock("./formulation-form", () => ({ FormulationForm: () => null, PURE_BIOCHAR_CUE: "Pure biochar, no ingredients." }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
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
  RowActionsMenu: ({ label, actions }: { label: string; actions: Array<{ label: string }> }) => (
    <ul aria-label={label}>{actions.map((action) => <li key={action.label}>{action.label}</li>)}</ul>
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
  state.items = [];
});
afterEach(cleanup);

describe("FormulationList summary card", () => {
  it("shows the server total without page wording", () => {
    state.stats = { data: { totalFormulations: 42 }, isLoading: false, isError: false };
    render(<FormulationList />);

    const card = screen.getByLabelText("Active formulations");
    expect(card.textContent).toContain("42");
    expect(document.body.textContent).not.toContain("on this page");
  });

  it("keeps the archived toggle as the card scope", () => {
    state.stats = { data: { totalFormulations: 3 }, isLoading: false, isError: false };
    render(<FormulationList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));

    const card = screen.getByLabelText("Archived formulations");
    expect(card.textContent).toContain("3");
  });

  it("shows the failure, not zero, when the total could not load", () => {
    state.stats = { data: undefined, isLoading: false, isError: true };
    render(<FormulationList />);

    expect(screen.getByLabelText("Active formulations").textContent).toContain("Could not load");
  });
});
