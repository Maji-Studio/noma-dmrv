// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ActionError } from "@/lib/action-error";
import { inUseDeleteRefusal } from "@/lib/delete-refusal";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedstockType } from "@/db/schema";

const state = vi.hoisted(() => ({ remove: vi.fn(), error: vi.fn() }));
beforeEach(() => { state.remove.mockReset(); state.error.mockReset(); });
afterEach(cleanup);

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: () => [null, vi.fn()],
}));

const activeType: FeedstockType = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "org-1",
  code: "FT-001",
  name: "Coffee husks",
  category: "agricultural",
  usage: "pyrolysis",
  description: null,
  registryUrl: null,
  isometricFeedstockTypeId: "feedstock_type_iso_1",
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  version: 1,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const archivedType: FeedstockType = {
  ...activeType,
  id: "22222222-2222-4222-8222-222222222222",
  code: "FT-002",
  name: "Retired wood chips",
  isometricFeedstockTypeId: null,
  archivedAt: new Date("2026-07-22T00:00:00Z"),
};

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
}));
// Mutable so a case can render the disconnected variant: the import trigger is
// gated on a registry mapping being present.
const certifier = vi.hoisted(() => ({
  mapping: { id: "mapping-1" } as { id: string } | null,
}));
vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({ data: { mapping: certifier.mapping } }),
}));
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: () => undefined,
}));
vi.mock("@/hooks/use-feedstock-types", () => ({
  useFeedstockTypeList: () => ({
    data: [activeType, archivedType],
    isLoading: false,
    error: null,
  }),
  useCreateFeedstockType: () => ({ startDraft: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateFeedstockType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveFeedstockType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnarchiveFeedstockType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFeedstockType: () => ({ mutateAsync: state.remove, isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: state.error }),
}));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  ArchiveIcon: () => <span />,
  DatabaseIcon: () => <span />,
  LeafIcon: () => <span />,
  PlusIcon: () => <span />,
  SealCheckIcon: () => <span data-icon="isometric" />,
  InfoIcon: () => null,
  WarningIcon: () => null,
  WarningCircleIcon: () => null,
  CheckCircleIcon: () => null,
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
  EmptyState: ({ title }: { title: string }) => <section>{title}</section>,
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
  RowActionsMenu: ({ label, actions }: { label: string; actions: Array<{ label: string; onSelect: () => void }> }) => (
    <div role="group" aria-label={label}>{actions.map((action) => <button key={action.label} onClick={action.onSelect}>{action.label}</button>)}</div>
  ),
  SplitButton: ({
    children,
    menuLabel,
    items,
  }: {
    children?: ReactNode;
    menuLabel: string;
    items: Array<{ label: string }>;
  }) => (
    <div>
      <button>{children}</button>
      <button aria-label={menuLabel} />
      {items.map((item) => (
        <span key={item.label}>{item.label}</span>
      ))}
    </div>
  ),
}));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: Object.assign(
    ({ columns, data }: { columns: Array<Record<string, unknown>>; data: FeedstockType[] }) => (
      <div>
        {data.map((item) => (
          <div key={item.id}>
            {columns.map((column, index) => {
              const cell = column.cell;
              const accessorKey = column.accessorKey;
              const content =
                typeof cell === "function"
                  ? cell({ row: { original: item } })
                  : typeof accessorKey === "string"
                    ? String(item[accessorKey as keyof FeedstockType] ?? "")
                    : null;
              return <div key={String(column.id ?? accessorKey ?? index)}>{content as ReactNode}</div>;
            })}
          </div>
        ))}
      </div>
    ),
    {
      Toolbar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      Search: () => null,
      ColumnVisibility: () => null,
      Pagination: () => null,
    },
  ),
}));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? <button onClick={onConfirm}>Confirm delete</button> : null,
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("./feedstock-type-form", () => ({ FeedstockTypeForm: () => null }));
vi.mock("./feedstock-type-sampling", () => ({ FeedstockTypeSampling: () => null }));
vi.mock("./isometric-feedstock-import-dialog", () => ({
  IsometricFeedstockImportDialog: () => null,
}));

import {
  FeedstockTypeList,
  shouldShowFeedstockTypeSampling,
} from "./feedstock-type-list";

describe("FeedstockTypeList", () => {
  it("renders Isometric linkage and visually mutes archived catalogue entries", () => {
    const html = renderToStaticMarkup(<FeedstockTypeList canManage={false} />);

    expect(html).toContain("Coffee husks");
    expect(html).toContain("Isometric");
    expect(html).toContain("Retired wood chips");
    expect(html).toContain('data-archived="true"');
    expect(html).toContain("Archived");
  });

  // The only other coverage of this trigger is `@live`-tagged and skipped
  // without sandbox credentials, so PR CI would not catch it disappearing
  // again (it already did once). This case keeps it hermetic.
  it("renders the split-button menu trigger for a manager on a connected facility", () => {
    const html = renderToStaticMarkup(<FeedstockTypeList canManage />);

    // The import item lives inside the closed split-button menu.
    expect(html).toContain('aria-label="More ways to add a feedstock type"');
    expect(html).toContain("Import from Isometric");
    expect(html).toContain("New feedstock type");
  });

  it("withholds the Isometric import trigger without a registry connection", () => {
    certifier.mapping = null;
    try {
      const html = renderToStaticMarkup(<FeedstockTypeList canManage />);

      expect(html).not.toContain("More ways to add a feedstock type");
      expect(html).not.toContain("Import from Isometric");
      expect(html).toContain("New feedstock type");
    } finally {
      certifier.mapping = { id: "mapping-1" };
    }
  });

  it("withholds both header actions from a viewer who cannot manage", () => {
    const html = renderToStaticMarkup(<FeedstockTypeList canManage={false} />);

    expect(html).not.toContain("More ways to add a feedstock type");
    expect(html).not.toContain("Import from Isometric");
    expect(html).not.toContain("New feedstock type");
  });

  it("offers Archive instead from the structured reason with different wording", async () => {
    const message = "This feedstock type is still used.";
    state.remove.mockRejectedValue(new ActionError({ error: message, ...inUseDeleteRefusal(message, ["feedstockTypeId"]) }));
    render(<FeedstockTypeList canManage />);
    fireEvent.click(within(screen.getByRole("group", { name: "Actions for FT-001" })).getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByRole("button", { name: "Archive instead" })).toBeTruthy();
    expect(state.remove).toHaveBeenCalledWith({ feedstockTypeId: activeType.id, expectedVersion: 1 });
    expect(state.error).not.toHaveBeenCalled();
  });

  it("offers only Close for an archived feedstock type in use", async () => {
    const message = "This feedstock type is still used.";
    state.remove.mockRejectedValue(new ActionError({ error: message, ...inUseDeleteRefusal(message, ["feedstockTypeId"]) }));
    render(<FeedstockTypeList canManage />);
    fireEvent.click(within(screen.getByRole("group", { name: "Actions for FT-002" })).getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect((await screen.findAllByRole("button", { name: "Close" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
  });

  it("gates sampling to connected pyrolysis types with an active facility", () => {
    expect(
      shouldShowFeedstockTypeSampling({
        feedstockType: activeType,
        hasRegistryConnection: false,
        facilityId: "facility-1",
      }),
    ).toBe(false);
    expect(
      shouldShowFeedstockTypeSampling({
        feedstockType: { ...activeType, usage: "blend" },
        hasRegistryConnection: true,
        facilityId: "facility-1",
      }),
    ).toBe(false);
    expect(
      shouldShowFeedstockTypeSampling({
        feedstockType: activeType,
        hasRegistryConnection: true,
        facilityId: "facility-1",
      }),
    ).toBe(true);
  });
});
