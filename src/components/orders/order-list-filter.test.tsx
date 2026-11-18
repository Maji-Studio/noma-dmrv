// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORDER_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const OTHER_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const harness = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  list: vi.fn(),
  stats: vi.fn(),
}));

vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
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
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "f1", facilities: [] }) }));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).openRecordLocksModule);
vi.mock("@/components/record-locks", () => ({
  recordLockSheetProps: () => ({}),
  recordLockTitleMark: () => null,
  RecordLockListNotice: () => null,
}));
vi.mock("@/hooks/use-orders", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false, startDraft: vi.fn() });
  return {
    useOrders: (filters: unknown) => {
      harness.list(filters);
      return { data: { items: [], total: 0, totalPages: 0 }, isLoading: false, error: null };
    },
    useOrderStats: (...args: unknown[]) => {
      harness.stats(...args);
      return { data: undefined, isLoading: false, isError: false };
    },
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

import { OrderList } from "./order-list";

beforeEach(() => {
  harness.query = {};
  harness.list.mockReset();
  harness.stats.mockReset();
});
afterEach(cleanup);

describe("OrderList affected-record filter", () => {
  it.each([
    { ids: [ORDER_ID, OTHER_ID], label: "2 affected orders" },
    { ids: [ORDER_ID], label: "1 affected order" },
  ])("shows $label and passes exact ids to the hook", ({ ids, label }) => {
    harness.query = { ids: ids.join(",") };
    render(<OrderList />);
    expect(screen.getByText(label)).toBeDefined();
    expect(harness.list).toHaveBeenLastCalledWith(expect.objectContaining({ ids, facilityId: "f1" }));
    expect(screen.getByRole("button", { name: "Clear" })).toBeDefined();
  });

  it("normalizes invalid and duplicate ids before filtering", () => {
    harness.query = { ids: `${ORDER_ID.toUpperCase()},invalid,${ORDER_ID}` };
    render(<OrderList />);
    expect(screen.getByText("1 affected order")).toBeDefined();
    expect(harness.query.ids).toBe(ORDER_ID);
    expect(harness.list).toHaveBeenLastCalledWith(expect.objectContaining({ ids: [ORDER_ID] }));
  });

  it("clears the affected ids with Clear and keeps stats facility-wide", () => {
    harness.query = { ids: `${ORDER_ID},${OTHER_ID}` };
    const view = render(<OrderList />);
    expect(harness.stats).toHaveBeenLastCalledWith("f1", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(harness.query.ids).toBeNull();
    view.rerender(<OrderList />);
    expect(screen.queryByText("2 affected orders")).toBeNull();
    expect(harness.list).toHaveBeenLastCalledWith(expect.objectContaining({ ids: undefined }));
  });

  it("shows no chip without the param", () => {
    render(<OrderList />);
    expect(screen.queryByText(/affected order/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
