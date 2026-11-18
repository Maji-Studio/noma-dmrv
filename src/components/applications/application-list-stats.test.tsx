// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAT_CARD_ERROR_VALUE } from "@/components/ui/stat-card";
import { ApplicationList } from "./application-list";

const TOTAL_APPLICATIONS = 37;
const TOTAL_TONS = 12.5;
const TOTAL_DRY_TONS = 9.6;
const TOTAL_KG_TEXT = "12,500 kg";
const TOTAL_DRY_KG_TEXT = "9,600 kg";

const state = vi.hoisted(() => ({
  stats: { data: undefined as unknown, isLoading: false, isError: false },
  search: null as string | null,
  pageSize: 10,
  openCreate: null as null | (() => void),
  sheet: null as null | { open: boolean; mode: string },
}));
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: (open: () => void) => {
    state.openCreate = open;
  },
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [key === "q" ? state.search : null, vi.fn()],
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "f1", selectedFacility: { id: "f1", name: "Facility", timeZone: "UTC" } }),
}));
vi.mock("@/hooks/use-linked-application-delivery", () => ({ useLinkedApplicationDelivery: () => ({ data: undefined, isPending: false, error: null, isFetching: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/use-applications", () => ({
  useApplications: () => ({ data: { items: [], total: 2, totalPages: 1 }, isLoading: false, error: null }),
  useApplicationStats: () => state.stats,
  useApplicationDeliveryOptions: () => ({ data: [] }),
  useCreateApplication: () => ({ startDraft: vi.fn(), isPending: false, mutateAsync: vi.fn() }),
  useUpdateApplication: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteApplication: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: state.pageSize, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-record-certification-lock", () => ({
  useRecordCertificationLock: () => ({ data: false }),
  useIsRecordCertificationLocked: () => false,
}));
vi.mock("@/hooks/use-record-locks", () => ({
  useRecordLocks: () => ({ data: undefined, locks: new Map() }),
  useRecordLock: () => ({ lock: undefined, status: "idle", retry: vi.fn(), retrying: false }),
}));
vi.mock("@/components/record-locks", () => ({
  recordLockSheetProps: () => ({}),
  recordLockTitleMark: () => null,
  RecordLockListNotice: () => null,
}));
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: [] }) }));
vi.mock("@/hooks/use-create-with-evidence", () => ({
  useCreateWithEvidence: () => ({ confirmClose: () => true, reset: vi.fn(), start: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-file-upload", () => ({ useFileUpload: () => ({ upload: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: (props: { open: boolean; mode: string }) => {
    state.sheet = { open: props.open, mode: props.mode };
    return null;
  },
}));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("@/components/ui/data-table", () => {
  const Slot = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DataTable: Object.assign(Slot, { Toolbar: Slot, Controls: Slot, Search: () => null, FilterSelect: () => null, ColumnVisibility: () => null, Pagination: () => null }),
  };
});

afterEach(cleanup);

function renderList() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ApplicationList />
    </QueryClientProvider>,
  );
}

describe("ApplicationList summary cards", () => {
  it("shows the server totals whatever the page size or search", () => {
    state.stats = { data: { totalApplications: TOTAL_APPLICATIONS, totalBiocharAppliedTons: TOTAL_TONS, totalBiocharAppliedDryTons: TOTAL_DRY_TONS }, isLoading: false, isError: false };
    for (const [search, pageSize] of [[null, 10], ["maize", 10], [null, 50]] as const) {
      state.search = search;
      state.pageSize = pageSize;
      const { unmount } = renderList();
      expect(screen.getByText(String(TOTAL_APPLICATIONS))).toBeTruthy();
      expect(screen.getByText(TOTAL_KG_TEXT)).toBeTruthy();
      expect(screen.getByText(TOTAL_DRY_KG_TEXT)).toBeTruthy();
      unmount();
    }
  });

  it("states the scope in plain words and never says 'on this page'", () => {
    state.stats = { data: { totalApplications: TOTAL_APPLICATIONS, totalBiocharAppliedTons: TOTAL_TONS, totalBiocharAppliedDryTons: TOTAL_DRY_TONS }, isLoading: false, isError: false };
    const { container } = renderList();
    expect(container.textContent).not.toMatch(/on this page/i);
    expect(screen.getByText("All applications in this facility")).toBeTruthy();
  });

  it("labels the wet product first and the dry biochar second, never one unqualified total", () => {
    state.stats = { data: { totalApplications: TOTAL_APPLICATIONS, totalBiocharAppliedTons: TOTAL_TONS, totalBiocharAppliedDryTons: TOTAL_DRY_TONS }, isLoading: false, isError: false };
    const { container } = renderList();
    const labels = Array.from(container.querySelectorAll("dt")).map((node) => node.textContent);
    expect(labels).toEqual(["Wet product", "Dry biochar"]);
    expect(container.textContent).not.toMatch(/total biochar applied/i);
  });

  it("shows the failure, not zeros, when the totals could not load", () => {
    state.stats = { data: undefined, isLoading: false, isError: true };
    renderList();
    expect(screen.getAllByText(STAT_CARD_ERROR_VALUE)).toHaveLength(2);
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("ApplicationList create link", () => {
  it("opens the create sheet when the page is opened with ?create=true", () => {
    renderList();
    expect(state.sheet?.open).toBe(false);
    act(() => state.openCreate?.());
    expect(state.sheet).toEqual({ open: true, mode: "create" });
  });
});
