// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAT_CARD_ERROR_VALUE } from "@/components/ui/stat-card";
import { OrderList } from "./order-list";

const state = vi.hoisted(() => ({
  stats: { data: undefined as unknown, isLoading: false, isError: true },
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: () => [null, vi.fn()],
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "f1", facilities: [] }) }));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-record-locks", () => ({
  useRecordLocks: () => ({ data: undefined }),
  useRecordLock: () => ({ lock: undefined, status: "idle", retry: vi.fn(), retrying: false }),
}));
vi.mock("@/components/record-locks", () => ({
  recordLockSheetProps: () => ({}),
  recordLockTitleMark: () => null,
  RecordLockListNotice: () => null,
}));
vi.mock("@/hooks/use-orders", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false, startDraft: vi.fn() });
  return {
    useOrders: () => ({
      data: { items: [], total: 25, totalPages: 3 },
      isLoading: false,
      error: null,
    }),
    useOrderStats: () => state.stats,
    useOrderWithRelations: () => ({ data: undefined }),
    useCreateOrder: mutation,
    useUpdateOrder: mutation,
    useDeleteOrder: mutation,
  };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/forms", () => ({ EntitySelect: () => null, ServerError: () => null }));
vi.mock("./order-form", () => ({ OrderForm: () => null }));
vi.mock("./order-read-sections", () => ({ orderSheetSections: () => [] }));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 0 }, OrderArt: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/ui/data-table", () => {
  const Slot = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DataTable: Object.assign(Slot, {
      Toolbar: Slot, Controls: Slot, Search: () => null, FilterSelect: () => null, ColumnVisibility: () => null, Pagination: () => null,
    }),
  };
});

afterEach(cleanup);

describe("OrderList summary cards", () => {
  it("shows the failure, not zeros, when the totals could not load", () => {
    state.stats = { data: undefined, isLoading: false, isError: true };
    render(<OrderList />);

    expect(screen.getAllByText(STAT_CARD_ERROR_VALUE)).toHaveLength(3);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("0 kg")).toBeNull();
  });

  it("shows the server totals when they load", () => {
    state.stats = { data: { totalOrders: 25, totalDeliveries: 7, totalQuantityKg: 9000 }, isLoading: false, isError: false };
    render(<OrderList />);

    expect(screen.getByText("25")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("9,000 kg")).toBeTruthy();
  });
});
