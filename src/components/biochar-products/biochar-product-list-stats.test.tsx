// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STAT_CARD_ERROR_VALUE } from "@/components/ui/stat-card";
import { BiocharProductList } from "./biochar-product-list";

const state = vi.hoisted(() => ({
  stats: { data: undefined as unknown, isLoading: false, isError: true },
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: () => [null, vi.fn()],
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "f1", facilities: [] }) }));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
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
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: [] }) }));
vi.mock("@/hooks/use-biochar-products", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false, startDraft: vi.fn() });
  return {
    useBiocharProducts: () => ({
      data: { items: [], total: 25, totalPages: 3 },
      isLoading: false,
      error: null,
    }),
    useBiocharProductStats: () => state.stats,
    useBiocharProduct: () => ({ data: undefined, isError: false }),
    useCreateBiocharProduct: mutation,
    useUpdateBiocharProduct: mutation,
    useDeleteBiocharProduct: mutation,
  };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("./biochar-product-form", () => ({ BiocharProductForm: () => null }));
vi.mock("./product-read-details", () => ({ productSheetSections: () => [] }));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 0 }, BiocharProductArt: () => null }));
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

describe("BiocharProductList summary cards", () => {
  it("shows the failure, not zeros, when the totals could not load", () => {
    state.stats = { data: undefined, isLoading: false, isError: true };
    render(<BiocharProductList />);

    expect(screen.getAllByText(STAT_CARD_ERROR_VALUE)).toHaveLength(2);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("0 kg")).toBeNull();
  });

  it("shows the server totals when they load", () => {
    state.stats = {
      data: { totalProducts: 25, totalWetMassKg: 1794, totalDryBiocharMassKg: 807.3 },
      isLoading: false,
      isError: false,
    };
    render(<BiocharProductList />);

    expect(screen.getByText("25")).toBeTruthy();
    expect(screen.getByText("1,794 kg")).toBeTruthy();
  });
});
