// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAT_CARD_ERROR_VALUE } from "@/components/ui/stat-card";
import { CustomerList } from "./customer-list";

const TOTAL_CUSTOMERS = 41;
const TOTAL_LOCATIONS = 63;
const PAGE_ITEM_COUNT = 2;

const state = vi.hoisted(() => ({
  stats: { data: undefined as unknown, isLoading: false, isError: false },
  search: null as string | null,
  pageSize: 10,
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [key === "q" ? state.search : null, vi.fn()],
}));
vi.mock("@/hooks/use-customers", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useCustomers: () => ({
      data: { items: Array.from({ length: PAGE_ITEM_COUNT }, (_, i) => ({ id: `c${i}`, code: `C-${i}`, name: `Customer ${i}`, version: 1, archivedAt: null, cropType: null, locationCount: 1 })), total: PAGE_ITEM_COUNT, totalPages: 1 },
      isLoading: false,
      error: null,
    }),
    useCustomerStats: () => state.stats,
    useCustomerWithRelations: () => ({ data: null, isLoading: false, isFetching: false, isPending: false, isSuccess: true, isError: false }),
    useCustomerLocations: () => ({ data: [], isLoading: false }),
    useCreateCustomerWithLocations: mutation,
    useUpdateCustomer: mutation,
    useCustomerDeletePreview: () => ({ data: undefined, error: null, isPending: false, isError: false }),
    useDeleteCustomer: mutation,
    useArchiveCustomer: mutation,
    useRestoreCustomer: mutation,
  };
});
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: state.pageSize, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("./customer-form", () => ({ CustomerForm: () => null }));
vi.mock("./customer-read-sections", () => ({ customerSheetSections: () => [] }));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 0 }, CustomerArt: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("@/components/ui/data-table", () => {
  const Slot = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DataTable: Object.assign(Slot, { Toolbar: Slot, Controls: Slot, Search: () => null, ColumnVisibility: () => null, Pagination: () => null }),
  };
});

afterEach(cleanup);

describe("CustomerList summary cards", () => {
  it("shows the server totals whatever the page size or search", () => {
    state.stats = { data: { totalCustomers: TOTAL_CUSTOMERS, totalLocations: TOTAL_LOCATIONS }, isLoading: false, isError: false };
    const seen: string[] = [];
    for (const [search, pageSize] of [[null, 10], ["acme", 10], [null, 50]] as const) {
      state.search = search;
      state.pageSize = pageSize;
      const { container, unmount } = render(<CustomerList />);
      expect(screen.getByText(String(TOTAL_CUSTOMERS))).toBeTruthy();
      expect(screen.getByText(String(TOTAL_LOCATIONS))).toBeTruthy();
      seen.push(container.textContent ?? "");
      unmount();
    }
    expect(new Set(seen.map((text) => text.match(/Active customers[\s\S]*?Total locations[^]*?(?=Search|$)/)?.[0])).size).toBe(1);
  });

  it("states the scope in plain words and never says 'on this page'", () => {
    state.stats = { data: { totalCustomers: TOTAL_CUSTOMERS, totalLocations: TOTAL_LOCATIONS }, isLoading: false, isError: false };
    const { container } = render(<CustomerList />);
    expect(container.textContent).not.toMatch(/on this page/i);
    expect(screen.getByText("Locations of all customers that are not archived")).toBeTruthy();
    expect(screen.queryByText("All customers that are not archived")).toBeNull();
  });

  it("shows the failure, not zeros, when the totals could not load", () => {
    state.stats = { data: undefined, isLoading: false, isError: true };
    render(<CustomerList />);
    expect(screen.getAllByText(STAT_CARD_ERROR_VALUE)).toHaveLength(2);
    expect(screen.queryByText("0")).toBeNull();
  });
});
