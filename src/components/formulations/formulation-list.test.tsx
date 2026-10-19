// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormulationWithIngredients } from "@/data-access/formulations";
import { FormulationList } from "./formulation-list";

const state = vi.hoisted(() => ({
  filters: [] as Array<{ archived?: boolean }>,
  items: [] as unknown[],
}));

function formulation(code: string, archivedAt: Date | null): FormulationWithIngredients {
  return {
    id: `id-${code}`, code, name: `Blend ${code}`, version: 1, biocharRatio: 1, description: null,
    archivedAt, ingredients: [],
  } as unknown as FormulationWithIngredients;
}

vi.mock("@/hooks/use-formulations", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
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
vi.mock("@/components/ui/stat-card", () => ({ StatCard: ({ title }: { title: string }) => <section>{title}</section> }));
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
  state.items = [formulation("BCF-0001", null), formulation("BCF-0002", new Date("2026-01-01"))];
});
afterEach(cleanup);

describe("FormulationList archive view", () => {
  it("toggles between the active and archived server filters", () => {
    render(<FormulationList />);
    const toggle = screen.getByRole("button", { name: "Archived" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Active formulations")).toBeTruthy();
    expect(state.filters.at(-1)?.archived).toBe(false);

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Archived" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Archived formulations")).toBeTruthy();
    expect(state.filters.at(-1)?.archived).toBe(true);
  });

  it("offers Edit and Archive on active rows, Restore on archived rows", () => {
    render(<FormulationList />);
    const activeMenu = within("Actions for BCF-0001");
    expect(activeMenu).toEqual(["Edit", "Archive", "Delete"]);

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(within("Actions for BCF-0002")).toEqual(["Restore", "Delete"]);
  });

  it("explains an empty archived view", () => {
    state.items = [formulation("BCF-0001", null)];
    render(<FormulationList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.getByText("No archived formulations")).toBeTruthy();
    expect(screen.getByText("Formulations you archive will appear here and can be restored.")).toBeTruthy();
  });
});

function within(label: string): string[] {
  return Array.from(screen.getByRole("list", { name: label }).querySelectorAll("li")).map((item) => item.textContent ?? "");
}
