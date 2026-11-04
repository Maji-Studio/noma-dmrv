// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FEEDSTOCK_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const OTHER_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const FACILITY_ID = "11111111-1111-4111-8111-111111111111";

const harness = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  list: vi.fn(),
}));

vi.mock("@/hooks/use-facilities", async (importOriginal) => (await import("../../../tests/helpers/facility-lookup-mocks")).activeFacilityLookupModule(await importOriginal()));
vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [
    harness.query[key] ?? null,
    (value: string | null) => {
      harness.query[key] = value;
      return Promise.resolve(new URLSearchParams());
    },
  ],
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
  useFacilityContext: () => ({ facilityId: FACILITY_ID }),
}));
vi.mock("@/hooks/use-feedstocks", () => ({
  useFeedstocks: (filters: unknown) => {
    harness.list(filters);
    return { data: { items: [], total: 0, totalPages: 0 }, isLoading: false, error: null };
  },
  useFetchFeedstock: () => vi.fn(),
  useFeedstock: () => ({ data: undefined, error: null, isSuccess: false, isLoading: false }),
  useCreateFeedstock: () => ({ startDraft: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateFeedstock: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  useListPagination: () => ({ currentPage: 1, pageSize: 25, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: string) => value }));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("./use-feedstock-type-filter", () => ({
  useFeedstockTypeFilter: () => ({ feedstockTypeId: "", setFeedstockTypeId: vi.fn() }),
  useFeedstockTypeFilterOptions: () => [],
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  CalendarIcon: () => null,
  PackageIcon: () => null,
  PlusIcon: () => null,
  XIcon: () => null,
}));
vi.mock("@/hooks/use-record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).openRecordLocksModule);
vi.mock("@/components/record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).stubRecordLockComponentsModule);
vi.mock("@/components/ui", () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
  EmptyState: () => null,
  PageHeader: () => null,
  RowActionsMenu: () => null,
}));
vi.mock("@/components/ui/data-table", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { DataTable: Object.assign(Container, {
    Toolbar: Container, Controls: Container, Search: () => null,
    FilterSelect: () => null, ColumnVisibility: () => null, Pagination: () => null,
  }) };
});
vi.mock("@/components/ui/status-badge", () => ({ StatusBadge: () => null }));
vi.mock("@/components/ui/moisture-split", () => ({ MoistureSplit: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/ui/in-use-delete-dialog", () => ({ InUseDeleteDialog: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/transport-legs", () => ({ TransportEvidencePanel: () => null, TransportLegsSummary: () => null }));
vi.mock("@/components/transport-legs/transport-distance-drift", () => ({ TransportDistanceDriftNotice: () => null }));
vi.mock("@/hooks/use-transport-distance-refresh", () => ({ useTransportDistanceDrift: () => ({ data: undefined, isPending: false }) }));
vi.mock("@/components/certification/entity-certify-readiness-badge", () => ({ EntityCertifyReadinessBadge: () => null }));
vi.mock("./feedstock-form", () => ({ FeedstockForm: () => null }));

import { FeedstockList } from "./feedstock-list";

beforeEach(() => {
  harness.query = {};
  harness.list.mockReset();
});
afterEach(cleanup);

describe("FeedstockList affected-record filter", () => {
  it.each([
    { ids: [FEEDSTOCK_ID, OTHER_ID], label: "2 affected feedstocks" },
    { ids: [FEEDSTOCK_ID], label: "1 affected feedstock" },
  ])("shows $label and passes exact ids to the hook", ({ ids, label }) => {
    harness.query = { ids: ids.join(",") };
    render(<FeedstockList />);
    expect(screen.getByText(label)).toBeDefined();
    expect(harness.list).toHaveBeenLastCalledWith(expect.objectContaining({ ids, facilityId: FACILITY_ID }));
    expect(screen.getByRole("button", { name: "Clear" })).toBeDefined();
  });

  it("normalizes invalid and duplicate ids before filtering", () => {
    harness.query = { ids: `${FEEDSTOCK_ID.toUpperCase()},invalid,${FEEDSTOCK_ID}` };
    render(<FeedstockList />);
    expect(screen.getByText("1 affected feedstock")).toBeDefined();
    expect(harness.query.ids).toBe(FEEDSTOCK_ID);
    expect(harness.list).toHaveBeenLastCalledWith(expect.objectContaining({ ids: [FEEDSTOCK_ID] }));
  });

  it("clears the affected ids with Clear", () => {
    harness.query = { ids: `${FEEDSTOCK_ID},${OTHER_ID}` };
    const view = render(<FeedstockList />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(harness.query.ids).toBeNull();
    view.rerender(<FeedstockList />);
    expect(screen.queryByText("2 affected feedstocks")).toBeNull();
    expect(harness.list.mock.lastCall?.[0]).not.toHaveProperty("ids");
  });

  it("shows no chip and no ids without the param", () => {
    render(<FeedstockList />);
    expect(screen.queryByText(/affected feedstock/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(harness.list.mock.lastCall?.[0]).not.toHaveProperty("ids");
  });
});
