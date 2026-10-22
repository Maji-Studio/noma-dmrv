import type { ReactNode } from "react";
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stats: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "f1" }),
}));
vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: (value: unknown) => value,
}));
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: () => undefined,
}));
vi.mock("@/hooks/use-reactors", () => ({
  useReactorStats: () => state.stats,
  useReactors: () => ({
    data: { items: [], total: 25, totalPages: 3 },
    isLoading: false,
    error: null,
  }),
  useCreateReactor: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateReactor: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteReactor: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));
vi.mock("@/components/ui/in-use-delete-dialog", () => ({ InUseDeleteDialog: () => null }));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  LightningIcon: () => <span />,
  FlaskIcon: () => <span />,
  PlusIcon: () => <span />,
}));
vi.mock("@/components/navigation", () => ({
  SelectFacilityEmptyState: ({ description }: { description: string }) => (
    <section>
      <h2>Select a facility</h2>
      <p>{description}</p>
    </section>
  ),
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  EmptyState: ({
    title,
    description,
    action,
  }: {
    title: string;
    description?: string;
    action?: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  ),
  PageHeader: ({
    title,
    subtitle,
    actions,
  }: {
    title: string;
    subtitle?: string;
    actions?: ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
    </header>
  ),
  RowActionsMenu: () => null,
}));
vi.mock("@/components/ui/data-table", () => {
  const DataTable = ({
    children,
    emptyMessage,
  }: {
    children?: ReactNode;
    emptyMessage?: ReactNode;
  }) => (
    <div>
      {children}
      {emptyMessage}
    </div>
  );
  const DataTableToolbar = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  const DataTableSearch = () => null;
  const DataTableColumnVisibility = () => null;
  const DataTablePagination = () => null;
  DataTable.Toolbar = DataTableToolbar;
  DataTable.Controls = DataTableToolbar;
  DataTable.Search = DataTableSearch;
  DataTable.ColumnVisibility = DataTableColumnVisibility;
  DataTable.Pagination = DataTablePagination;
  return { DataTable };
});
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({
    open,
    children,
  }: {
    open: boolean;
    children?: ReactNode;
  }) => (open ? <aside>{children}</aside> : null),
}));
vi.mock("@/components/ui/stat-card", () => ({
  StatCard: ({ title, value, description, isError }: { title: string; value: ReactNode; description?: string; isError?: boolean }) => (
    <section aria-label={title}>{isError ? "Could not load" : value}<small>{description}</small></section>
  ),
}));
vi.mock("@/components/forms", () => ({
  ServerError: ({ message }: { message: string }) => <p>{message}</p>,
}));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 0 }, ReactorArt: () => null }));
vi.mock("./reactor-form", () => ({
  ReactorForm: () => <form>Reactor form</form>,
}));

import { ReactorList } from "./reactor-list";

afterEach(cleanup);

describe("ReactorList summary cards", () => {
  it("shows the whole-facility totals with scope in plain words", () => {
    state.stats = { data: { totalReactors: 25, totalNominalThroughputTph: 12.5 }, isLoading: false, isError: false };
    render(<ReactorList />);

    expect(screen.getByLabelText("Total reactors").textContent).toContain("25");
    expect(screen.getByLabelText("Total reactors").textContent).toContain("All reactors in this facility");
    expect(screen.getByLabelText("Nominal throughput").textContent).toContain("12.5 tph");
    expect(document.body.textContent).not.toContain("on this page");
  });

  it("reads Not recorded when no reactor reports a throughput", () => {
    state.stats = { data: { totalReactors: 2, totalNominalThroughputTph: null }, isLoading: false, isError: false };
    render(<ReactorList />);

    expect(screen.getByLabelText("Nominal throughput").textContent).toContain("Not recorded");
  });

  it("shows the failure, not zeros, when the totals could not load", () => {
    state.stats = { data: undefined, isLoading: false, isError: true };
    render(<ReactorList />);

    expect(screen.getAllByText("Could not load")).toHaveLength(2);
  });
});
