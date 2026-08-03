import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FeedstockType } from "@/db/schema";

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
vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({ data: { mapping: { id: "mapping-1" } } }),
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
  useCreateFeedstockType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateFeedstockType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveFeedstockType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnarchiveFeedstockType: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteFeedstockType: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  ArchiveIcon: () => <span />,
  DatabaseIcon: () => <span />,
  LeafIcon: () => <span />,
  PlusIcon: () => <span />,
  SealCheckIcon: () => <span data-icon="isometric" />,
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
  EmptyState: ({ title }: { title: string }) => <section>{title}</section>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  RowActionsMenu: () => null,
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
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("./feedstock-type-form", () => ({ FeedstockTypeForm: () => null }));
vi.mock("./feedstock-type-sampling", () => ({ FeedstockTypeSampling: () => null }));
vi.mock("./isometric-feedstock-import-dialog", () => ({
  IsometricFeedstockImportDialog: () => null,
}));

import {
  FeedstockDeleteConflictNotice,
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

  it("offers archive as the actionable delete-conflict resolution", () => {
    const html = renderToStaticMarkup(
      <FeedstockDeleteConflictNotice
        name="Coffee husks"
        onArchive={vi.fn()}
        isPending={false}
      />,
    );

    expect(html).toContain("is in use and cannot be deleted");
    expect(html).toContain("Archive instead");
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
