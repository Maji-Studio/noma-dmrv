// @vitest-environment jsdom
/**
 * #1499: an order link into an archived facility opens the order sheet read
 * only over the current page, even with no active facility, and never makes
 * the archived facility the working one.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ARCHIVED_FACILITY = { id: "archived-facility", name: "Mafinga", archivedAt: new Date("2026-10-29") };
const ORDER = { id: "order-1", code: "OR-001", version: 3, facilityId: ARCHIVED_FACILITY.id, customerName: "E2E Customer" };

const harness = vi.hoisted(() => ({
  context: { activeOrganizationId: "org-a", facilityId: "f1" as string | null, facilities: [{ id: "f1" }], isLoading: false, setFacilityId: vi.fn() },
  sheet: null as null | { open: boolean; mode: string; title: string; readOnlyReason?: string; canEdit?: boolean },
}));

vi.mock("@/hooks/use-facilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-facilities")>()),
  useFacility: (id: string, enabled: boolean) => ({ data: enabled && id === ARCHIVED_FACILITY.id ? ARCHIVED_FACILITY : undefined, isError: false }),
}));
vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [key === "order" ? ORDER.id : null, vi.fn()],
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => harness.context }));
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
    useOrders: () => ({ data: { items: [], total: 0, totalPages: 0 }, isLoading: false, error: null }),
    useOrderStats: () => ({ data: undefined, isLoading: false, isError: false }),
    useOrderWithRelations: () => ({ data: ORDER, isLoading: false, isFetching: false, isPending: false, isSuccess: true, isError: false }),
    useCreateOrder: mutation,
    useUpdateOrder: mutation,
    useDeleteOrder: mutation,
  };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/forms", () => ({ EntitySelect: () => null, ServerError: () => null }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => <p>Select a facility</p> }));
vi.mock("./order-form", () => ({ OrderForm: () => null }));
vi.mock("./order-read-sections", () => ({ orderSheetSections: () => [] }));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 0 }, OrderArt: () => null }));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: Object.assign(() => null, { Toolbar: () => null, Controls: () => null, Search: () => null, FilterSelect: () => null, ColumnVisibility: () => null, Pagination: () => null }),
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: (props: { open: boolean; mode: string; title: string; readOnlyReason?: string; canEdit?: boolean }) => {
    harness.sheet = { open: props.open, mode: props.mode, title: props.title, readOnlyReason: props.readOnlyReason, canEdit: props.canEdit };
    return null;
  },
}));

import { OrderList } from "./order-list";

beforeEach(() => {
  harness.context.facilityId = "f1";
  harness.context.facilities = [{ id: "f1" }];
  harness.context.setFacilityId.mockClear();
  harness.sheet = null;
});
afterEach(cleanup);

const REASON = "Mafinga is archived, so this order is read-only.";

describe("Order link into an archived facility", () => {
  it("opens the order read only over the working facility's list", () => {
    render(<OrderList />);
    expect(harness.sheet).toMatchObject({ open: true, mode: "view", title: ORDER.code, readOnlyReason: REASON });
    expect(harness.context.setFacilityId).not.toHaveBeenCalled();
  });

  it("opens it over the empty state when no facility is active", () => {
    harness.context.facilityId = null;
    harness.context.facilities = [];
    const { getByText } = render(<OrderList />);
    expect(getByText("Select a facility")).toBeTruthy();
    expect(harness.sheet).toMatchObject({ open: true, mode: "view", title: ORDER.code, readOnlyReason: REASON });
    expect(harness.context.setFacilityId).not.toHaveBeenCalled();
  });
});
