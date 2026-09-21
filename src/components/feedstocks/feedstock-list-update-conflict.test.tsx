/**
 * The edit sheet's half of the negative-stock refusal: a refused update keeps
 * the sheet open on the operator's draft and names every record still drawing
 * on the bin. Without this, dropping `setUpdateBlockers` or `serverErrorAction`
 * would leave the operator with a sentence and no records.
 */
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ConflictError, conflictCode } from "@/lib/conflict-ref";
import { STOCK_CONFLICT_ENTITY } from "@/lib/stock-conflict-entities";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";
import type { FeedstockFormData } from "@/schemas/feedstocks";

const FEEDSTOCK_ID = "33333333-3333-4333-8333-333333333333";

const feedstock = {
  id: FEEDSTOCK_ID,
  code: "FS-001",
  facilityId: "facility-1",
  deliveryDate: "2026-09-01",
  supplierId: "supplier-1",
  supplierName: "Kilombero",
  supplierCode: "SUP-1",
  vehicleId: null,
  vehiclePlateNumber: null,
  transportDistanceKm: null,
  transportDistanceSource: null,
  transportTripType: null,
  feedstockTypeId: "type-1",
  feedstockTypeName: "Coffee husks",
  feedstockTypeCategory: "agricultural",
  massWetKg: 1000,
  massDryKg: 900,
  moistureContentPercent: 10,
  storageLocationId: "bin-1",
  storageLocationCode: "BIN-1",
  storageLocationName: "Bin 1",
  overrideJustification: null,
  notes: null,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
  createdAt: new Date("2026-09-01T00:00:00Z"),
} as unknown as FeedstockWithRelations;

// The draft the operator has on screen when the save is refused.
const draft = {
  facilityId: "facility-1",
  deliveryDate: "2026-09-02",
  supplierId: "supplier-1",
  feedstockTypeId: "type-1",
  totalWetMassKg: 400,
  moisturePercent: 10,
  allocations: [{ storageLocationId: "bin-1", allocatedWetMassKg: 400 }],
} as unknown as FeedstockFormData;

const refusal = new ConflictError(
  "Reducing this delivery would leave the bin short.",
  {
    conflict: {
      entity: STOCK_CONFLICT_ENTITY.storageLocation,
      id: "bin-1",
      code: conflictCode("BIN-1"),
    },
    blockers: [
      {
        entity: STOCK_CONFLICT_ENTITY.productionRun,
        id: "run-1",
        code: conflictCode("PR-014"),
      },
      {
        entity: STOCK_CONFLICT_ENTITY.biocharProduct,
        id: "product-1",
        code: conflictCode("BP-003"),
      },
    ],
  },
);

const mocks = vi.hoisted(() => ({
  form: undefined as
    | {
        feedstock?: { code?: string };
        serverError?: string;
        serverErrorAction?: unknown;
        onSubmit: (data: unknown) => Promise<void> | void;
      }
    | undefined,
  updateRejection: undefined as unknown,
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (name: string) => [
    name === "feedstock" ? FEEDSTOCK_ID : name === "mode" ? "edit" : null,
    vi.fn(),
  ],
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
}));
vi.mock("@/hooks/use-feedstocks", () => ({
  useFeedstocks: () => ({
    data: { items: [feedstock], totalPages: 1 },
    isLoading: false,
    error: null,
  }),
  useFeedstock: () => ({
    data: feedstock,
    error: null,
    isSuccess: true,
  }),
  useCreateFeedstock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateFeedstock: () => ({
    mutateAsync: vi.fn().mockRejectedValue(mocks.updateRejection),
    isPending: false,
  }),
  useDeleteFeedstock: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-create-with-evidence", () => ({
  useCreateWithEvidence: () => ({
    deferredAttachments: undefined,
    createdEntityIds: [],
    isFlushing: false,
    unsavedAttachmentCount: 0,
    handleCreate: vi.fn(),
    guardUpdate: () => false,
    confirmClose: () => true,
    reset: vi.fn(),
    runWhileFlushing: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({
    currentPage: 1,
    pageSize: 25,
    setCurrentPage: vi.fn(),
    onPaginationChange: vi.fn(),
  }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-debounce", () => ({
  useDebounce: (value: string) => value,
}));
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: () => undefined,
}));
vi.mock("./use-feedstock-type-filter", () => ({
  useFeedstockTypeFilter: () => ({ feedstockTypeId: "", setFeedstockTypeId: vi.fn() }),
  useFeedstockTypeFilterOptions: () => [],
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  CalendarIcon: () => null,
  PackageIcon: () => null,
  PlusIcon: () => null,
  XIcon: () => null,
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
  EmptyState: () => null,
  PageHeader: () => null,
  RowActionsMenu: () => null,
}));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: Object.assign(() => null, {
    Toolbar: () => null,
    Search: () => null,
    ColumnVisibility: () => null,
    Pagination: () => null,
  }),
}));
vi.mock("@/components/ui/status-badge", () => ({ StatusBadge: () => null }));
vi.mock("@/components/ui/moisture-split", () => ({ MoistureSplit: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: () => null,
}));
// Renders its children only while open, so a still-mounted form proves the
// sheet survived the refusal.
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/transport-legs", () => ({
  TransportEvidencePanel: () => null,
  TransportLegsSummary: () => null,
}));
vi.mock("@/components/certification/entity-certify-readiness-badge", () => ({
  EntityCertifyReadinessBadge: () => null,
}));
vi.mock("./feedstock-form", () => ({
  FeedstockForm: (props: NonNullable<typeof mocks.form>) => {
    mocks.form = props;
    return (
      <form>
        <span data-testid="draft-code">{props.feedstock?.code}</span>
        <span data-testid="server-error">{props.serverError}</span>
        {props.serverErrorAction as ReactNode}
      </form>
    );
  },
}));

import { FeedstockList } from "./feedstock-list";

function renderList() {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<FeedstockList />);
  });
  return renderer;
}

function textOf(renderer: ReactTestRenderer, testId: string) {
  return renderer.root
    .findByProps({ "data-testid": testId })
    .children.filter((child) => typeof child === "string")
    .join("");
}

describe("FeedstockList update conflict", () => {
  it("keeps the draft and names every record drawing on the bin", async () => {
    mocks.updateRejection = refusal;
    const renderer = renderList();

    await act(async () => {
      await mocks.form?.onSubmit(draft);
    });

    // The sheet is still mounted on the same record, so the draft survived.
    expect(renderer.root.findAllByType("form")).toHaveLength(1);
    expect(textOf(renderer, "draft-code")).toBe("FS-001");
    expect(textOf(renderer, "server-error")).toBe(
      "Reducing this delivery would leave the bin short.",
    );

    const rendered = JSON.stringify(renderer.toJSON());
    expect(rendered).toContain("Drawing on this bin:");
    expect(rendered).toContain("PR-014");
    expect(rendered).toContain("BP-003");
  });

  it("shows no blocker list when the refusal named no other record", async () => {
    mocks.updateRejection = new Error("Feedstock was not saved. Try again.");
    const renderer = renderList();

    await act(async () => {
      await mocks.form?.onSubmit(draft);
    });

    expect(textOf(renderer, "server-error")).toBe(
      "Feedstock was not saved. Try again.",
    );
    expect(JSON.stringify(renderer.toJSON())).not.toContain(
      "Drawing on this bin:",
    );
  });
});
