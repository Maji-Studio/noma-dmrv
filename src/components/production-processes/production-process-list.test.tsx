import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: null }),
}));
vi.mock("@/hooks/use-production-processes", () => ({
  useProductionProcessesByFacility: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));
vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({ data: null }),
}));
vi.mock("@phosphor-icons/react", () => ({
  FlowArrowIcon: () => <span />,
  CheckCircleIcon: () => <span />,
  LockOpenIcon: () => <span />,
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
  function DataTablePagination() {
    return null;
  }
  DataTable.Pagination = DataTablePagination;
  return { DataTable };
});
vi.mock("@/components/ui/stat-card", () => ({
  StatCard: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: () => null,
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
}));
vi.mock("@/components/forms", () => ({
  ServerError: ({ message }: { message: string }) => <p>{message}</p>,
}));
vi.mock("./method-pill", () => ({ MethodPill: () => null }));
vi.mock("./process-detail-panel", () => ({ ProcessDetailPanel: () => null }));
vi.mock("./unlock-method-b-dialog", () => ({
  UnlockMethodBDialog: () => null,
}));
vi.mock("./start-new-process-dialog", () => ({
  StartNewProcessDialog: () => null,
}));

import { ProductionProcessList } from "./production-process-list";

describe("ProductionProcessList without facility context", () => {
  it("renders one shared facility gate and no table or unlock controls", () => {
    const html = renderToStaticMarkup(<ProductionProcessList />);
    const facilityPromptCount = html.match(/Select a facility/g)?.length ?? 0;

    expect(facilityPromptCount).toBe(1);
    expect(html).toContain(
      "Choose a facility from the sidebar to view its production processes.",
    );
    expect(html).not.toContain("data-testid=\"data-table\"");
    expect(html).not.toContain("Unlock");
    expect(html).not.toContain("Start new process");
  });
});
