import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ facilityId: null as string | null }));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: state.facilityId }),
}));
vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: (value: unknown) => value,
}));
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: () => undefined,
}));
vi.mock("@/hooks/use-reactors", () => ({
  useReactorStats: () => ({ data: undefined, isLoading: false, isError: false }),
  useReactors: () => ({
    data: { items: [], total: 0, totalPages: 0 },
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
    columns,
    defaultColumnVisibility,
  }: {
    children?: ReactNode;
    emptyMessage?: ReactNode;
    columns?: Array<{ header?: unknown }>;
    defaultColumnVisibility?: Record<string, boolean>;
  }) => (
    <div
      data-testid="table"
      data-hidden-by-default={Object.keys(defaultColumnVisibility ?? {}).filter((id) => defaultColumnVisibility?.[id] === false).join(",")}
      data-headers={(columns ?? []).map((column) => column.header).filter(Boolean).join(",")}
    >
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
  StatCard: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/components/forms", () => ({
  ServerError: ({ message }: { message: string }) => <p>{message}</p>,
}));
vi.mock("./reactor-form", () => ({
  ReactorForm: () => <form>Reactor form</form>,
}));

import { ReactorList } from "./reactor-list";

describe("ReactorList without facility context", () => {
  it("renders only the shared facility gate and no create affordance", () => {
    const html = renderToStaticMarkup(<ReactorList />);

    expect(html).toContain("Select a facility");
    expect(html).toContain(
      "Choose a facility from the sidebar to view its reactors.",
    );
    expect(html).not.toContain("New reactor");
    expect(html).not.toContain("Create reactor");
    expect(html).not.toContain("<form");
  });
});

describe("ReactorList columns menu", () => {
  it("offers Nominal throughput as a field that starts hidden, and has no Facility column", () => {
    state.facilityId = "facility-1";
    try {
      const html = renderToStaticMarkup(<ReactorList />);
      const attribute = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1] ?? "";

      expect(attribute("data-headers")).toContain("Nominal throughput (tph)");
      expect(attribute("data-hidden-by-default")).toBe("nominalThroughputTph");
      expect(attribute("data-headers")).not.toContain("Facility");
    } finally {
      state.facilityId = null;
    }
  });
});
