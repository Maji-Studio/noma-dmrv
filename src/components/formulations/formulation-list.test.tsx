// @vitest-environment jsdom
import { ActionError } from "@/lib/action-error";
import { inUseDeleteRefusal } from "@/lib/delete-refusal";
import { formulationInUse } from "@/lib/formulation-domain-errors";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormulationWithIngredients } from "@/data-access/formulations";
import { FormulationList } from "./formulation-list";
import { linkedSheet } from "../../../tests/helpers/linked-sheet-mocks";

const state = vi.hoisted(() => ({
  remove: vi.fn(),
  filters: [] as Array<{ archived?: boolean }>,
  items: [] as unknown[],
  linked: { data: undefined as unknown, isError: false, isSuccess: false },
  toastError: vi.fn(),
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
    useFormulation: () => state.linked,
    useFormulationStats: () => ({ data: undefined, isLoading: false, isError: false }),
    useFormulations: (filters: { archived?: boolean }) => {
      state.filters.push(filters);
      const items = state.items.filter((item) => Boolean((item as FormulationWithIngredients).archivedAt) === Boolean(filters.archived));
      return { data: { items, total: items.length, totalPages: 1 }, isLoading: false, error: null };
    },
    useCreateFormulation: mutation, useUpdateFormulation: mutation, useDeleteFormulation: () => ({ mutateAsync: state.remove, isPending: false }),
    useArchiveFormulation: mutation, useRestoreFormulation: mutation,
  };
});
vi.mock("nuqs", async () => (await import("../../../tests/helpers/linked-sheet-mocks")).nuqsModule);
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: state.toastError }) }));
vi.mock("@/components/forms", () => ({ ServerError: ({ message }: { message: string }) => <p role="alert">{message}</p> }));
vi.mock("./formulation-form", () => ({ FormulationForm: () => null, PURE_BIOCHAR_CUE: "Pure biochar, no ingredients." }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ isOpen, onConfirm, errorMessage }: { isOpen: boolean; onConfirm: () => void; errorMessage?: string }) =>
    isOpen ? <div><button onClick={onConfirm}>Confirm delete</button>{errorMessage && <p role="alert">{errorMessage}</p>}</div> : null,
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ open, title, onOpenChange }: { open: boolean; title: string; onOpenChange: (open: boolean) => void }) =>
    open ? <div role="dialog" aria-label={title}><button type="button" onClick={() => onOpenChange(false)}>Close sheet</button></div> : null,
}));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: ({ title }: { title: string }) => <section>{title}</section> }));
vi.mock("@/components/ui", () => ({
  Button: ({ children, onClick, ...props }: { children?: ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <button type="button" onClick={onClick} aria-pressed={props["aria-pressed"] as boolean | undefined}>{children}</button>
  ),
  EmptyState: ({ title, description }: { title: string; description: string }) => <section><h2>{title}</h2><p>{description}</p></section>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  RowActionsMenu: ({ label, actions }: { label: string; actions: Array<{ label: string; onSelect: () => void }> }) => (
    <ul aria-label={label}>{actions.map((action) => <li key={action.label}><button onClick={action.onSelect}>{action.label}</button></li>)}</ul>
  ),
}));
vi.mock("@/components/ui/data-table", () => {
  const Slot = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DataTable: Object.assign(
      ({ columns, data, emptyMessage, children, onRowClick }: { columns: Array<Record<string, unknown>>; data: unknown[]; emptyMessage: ReactNode; children: ReactNode; onRowClick?: (row: unknown) => void }) => (
        <div>
          {children}
          {data.length === 0 && emptyMessage}
          {data.map((item) => (
            <div key={(item as { id: string }).id}>
              <button type="button" aria-label={`Open ${(item as { code: string }).code}`} onClick={() => onRowClick?.(item)} />
              {columns.map((column, index) => {
                const cell = column.cell as ((ctx: { row: { original: unknown } }) => ReactNode) | undefined;
                return <div key={index}>{cell?.({ row: { original: item } })}</div>;
              })}
            </div>
          ))}
        </div>
      ),
      { Toolbar: Slot, Controls: Slot, Search: () => null, ColumnVisibility: () => <button type="button">Columns</button>, Pagination: () => null },
    ),
  };
});

beforeEach(() => {
  linkedSheet.reset();
  state.linked = linkedSheet.record;
  state.toastError.mockReset();
  state.remove.mockReset();
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

  it("offers Archive instead for a structured refusal with different wording", async () => {
    const message = "This formulation is still used.";
    state.remove.mockRejectedValue(new ActionError({ error: message, ...inUseDeleteRefusal(message, ["formulationId"]) }));
    render(<FormulationList />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("button", { name: "Archive instead" })).toBeTruthy();
    expect(state.remove).toHaveBeenCalledWith({ formulationId: "id-BCF-0001", expectedVersion: 1 });
  });

  it("gives an archived formulation the Close-only in-use dialog", async () => {
    const message = "This formulation is still used.";
    state.remove.mockRejectedValue(new ActionError({ error: message, ...inUseDeleteRefusal(message, ["formulationId"]) }));
    render(<FormulationList />);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("dialog", { name: "BCF-0002 is in use" })).toBeTruthy();
    expect(screen.getByText("BCF-0002 cannot be deleted because other records still use it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    { archived: false, code: "BCF-0001" },
    { archived: true, code: "BCF-0002" },
  ])("names what uses the formulation (archived: $archived)", async ({ archived, code }) => {
    const error = formulationInUse("biochar products", ["BC-001"]);
    state.remove.mockRejectedValue(new ActionError({ error: error.message, ...error }));
    render(<FormulationList />);
    if (archived) fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByText(`${code} cannot be deleted because biochar products use it.`)).toBeTruthy();
  });

  it("keeps an unmarked conflict in the delete dialog", async () => {
    const message = "Formulation was not deleted because its name clashes.";
    state.remove.mockRejectedValue(new ActionError({ error: message, code: "conflict" }));
    render(<FormulationList />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
  });

  it("shows no Columns control: every record field is already a column", () => {
    render(<FormulationList />);
    expect(screen.queryByRole("button", { name: "Columns" })).toBeNull();
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

describe("FormulationList record link", () => {
  it("opens the sheet from ?formulation= with no facility involved", () => {
    linkedSheet.params.formulation = "id-BCF-0001";
    state.linked = { data: state.items[0], isError: false, isSuccess: true };
    render(<FormulationList />);
    expect(screen.getByRole("dialog", { name: "BCF-0001" })).toBeTruthy();
  });

  it("writes the param when a row opens, and clears it on close", () => {
    const view = render(<FormulationList />);
    fireEvent.click(screen.getByRole("button", { name: "Open BCF-0001" }));
    expect(linkedSheet.params.formulation).toBe("id-BCF-0001");
    view.rerender(<FormulationList />);
    expect(screen.getByRole("dialog", { name: "BCF-0001" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
    expect(linkedSheet.params.formulation).toBeNull();
    view.rerender(<FormulationList />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toasts and clears the param when the formulation is missing", () => {
    linkedSheet.params.formulation = "gone";
    state.linked = { data: undefined, isError: false, isSuccess: true };
    render(<FormulationList />);
    expect(state.toastError).toHaveBeenCalledWith("Linked formulation could not be opened");
    expect(linkedSheet.params.formulation).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
