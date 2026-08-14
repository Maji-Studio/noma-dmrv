import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: () => [null, vi.fn()],
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: null, selectedFacility: null }),
}));
vi.mock("@/hooks/use-applications", () => ({
  useApplications: () => ({
    data: { items: [], total: 0 },
    isLoading: false,
    error: null,
  }),
  useApplicationDeliveryOptions: () => ({ data: [] }),
  useCreateApplication: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateApplication: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteApplication: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ upload: vi.fn() }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  MapPinIcon: () => <span />,
  PlusIcon: () => <span />,
  LeafIcon: () => <span />,
  XIcon: () => <span />,
  CheckIcon: () => <span />,
  WarningIcon: () => <span />,
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
  EmptyState: ({ title }: { title: string }) => (
    <section>
      <h2>{title}</h2>
    </section>
  ),
  PageHeader: ({ title }: { title: string }) => (
    <header>
      <h1>{title}</h1>
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
    <div data-testid="data-table">
      {children}
      {emptyMessage}
      {emptyMessage}
    </div>
  );
  function DataTableToolbar({ children }: { children?: ReactNode }) {
    return <div>{children}</div>;
  }
  function DataTableSearch() {
    return null;
  }
  function DataTableColumnVisibility() {
    return null;
  }
  function DataTablePagination() {
    return null;
  }
  DataTable.Toolbar = DataTableToolbar;
  DataTable.Search = DataTableSearch;
  DataTable.ColumnVisibility = DataTableColumnVisibility;
  DataTable.Pagination = DataTablePagination;
  return { DataTable };
});
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: () => null,
}));
vi.mock("@/components/ui/stat-card", () => ({
  StatCard: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: () => null,
}));
vi.mock("@/components/forms", () => ({
  ServerError: ({ message }: { message: string }) => <p>{message}</p>,
}));
vi.mock("@/components/certification/entity-certify-readiness-badge", () => ({
  EntityCertifyReadinessBadge: () => null,
}));
vi.mock("./application-form", () => ({
  ApplicationForm: () => <form>Application form</form>,
}));

import { ApplicationList } from "./application-list";

describe("ApplicationList without facility context", () => {
  it("renders one shared facility gate and no list or create affordance", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ApplicationList />
      </QueryClientProvider>,
    );
    const facilityPromptCount = html.match(/Select a facility/g)?.length ?? 0;

    expect(facilityPromptCount).toBe(1);
    expect(html).toContain(
      "Choose a facility from the sidebar to view its applications.",
    );
    expect(html).not.toContain("New Application");
    expect(html).not.toContain("data-testid=\"data-table\"");
    expect(html).not.toContain("<form");
  });
});
