// @vitest-environment jsdom
/**
 * An order delete refused because deliveries use it opens the in-use dialog
 * (no Delete button, Close only); any other refusal stays in the confirm dialog.
 */
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";

const ORDER = { id: "order-1", code: "OR-001", version: 3, facilityId: "f1" };
const IN_USE_MESSAGE = "Order OR-001 was not deleted because delivery DL-001 still uses it. Delete that delivery first, or keep this order.";
const harness = vi.hoisted(() => ({ remove: vi.fn() }));

vi.mock("@/hooks/use-facilities", async (importOriginal) => (await import("../../../tests/helpers/facility-lookup-mocks")).activeFacilityLookupModule(await importOriginal()));
vi.mock("nuqs", () => ({ parseAsString: { withOptions: () => ({}) }, useQueryState: () => [null, vi.fn()] }));
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
    useOrders: () => ({ data: { items: [ORDER], total: 1, totalPages: 1 }, isLoading: false, error: null }),
    useOrderStats: () => ({ data: undefined, isLoading: false, isError: false }),
    useOrderWithRelations: () => ({ data: undefined }),
    useCreateOrder: mutation,
    useUpdateOrder: mutation,
    useDeleteOrder: () => ({ mutateAsync: harness.remove, isPending: false }),
  };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/forms", () => ({ EntitySelect: () => null, ServerError: ({ message }: { message: string }) => <p>{message}</p> }));
vi.mock("./order-form", () => ({ OrderForm: () => null }));
vi.mock("./order-read-sections", () => ({ orderSheetSections: () => [] }));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 0 }, OrderArt: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  RowActionsMenu: ({ actions }: { actions: Array<{ label: string; onSelect: () => void }> }) => (
    <div>{actions.map((action) => <button key={action.label} type="button" onClick={action.onSelect}>{`Row ${action.label}`}</button>)}</div>
  ),
}));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: Object.assign(
    ({ columns, data }: {
      columns: Array<{ id?: string; cell?: (context: { row: { original: unknown } }) => ReactNode }>;
      data: unknown[];
    }) => <div>{data.map((row, index) => <div key={index}>{columns.find((column) => column.id === "actions")?.cell?.({ row: { original: row } })}</div>)}</div>,
    { Toolbar: () => null, Controls: () => null, Search: () => null, FilterSelect: () => null, ColumnVisibility: () => null, Pagination: () => null },
  ),
}));

import { OrderList } from "./order-list";

afterEach(cleanup);

async function confirmDelete() {
  fireEvent.click(screen.getByRole("button", { name: "Row Delete" }));
  await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" })); });
}

describe("Order in-use delete refusal", () => {
  it("opens the in-use dialog with the server's reason and no Delete button", async () => {
    harness.remove.mockRejectedValue(new ActionError({
      error: IN_USE_MESSAGE, code: "certification_locked",
      issues: [{ path: ["orderId"], code: "certification_locked", message: IN_USE_MESSAGE, meta: { reason: "in_use", deliveryCode: "DL-001", deliveryId: "delivery-1", deliveries: [{ id: "delivery-1", code: "DL-001" }] } }],
    }));
    render(<OrderList />);
    await confirmDelete();

    expect(harness.remove).toHaveBeenCalledWith({ orderId: ORDER.id, expectedVersion: 3 });
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("OR-001 is in use")).toBeTruthy();
    expect(dialog.getByText(IN_USE_MESSAGE)).toBeTruthy();
    expect(dialog.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(dialog.queryByRole("button", { name: "Archive instead" })).toBeNull();
    expect(dialog.getByRole("link", { name: "Open delivery DL-001" }).getAttribute("href")).toBe("/deliveries?facility=f1&delivery=delivery-1");

    fireEvent.click(dialog.getAllByRole("button", { name: "Close" }).at(-1)!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("links every named delivery and leaves the remaining count in the message", async () => {
    const message = "Order OR-001 was not deleted because 5 deliveries still use it: DL-001, DL-002, DL-003 and 2 more. Delete those deliveries first, or keep this order.";
    harness.remove.mockRejectedValue(new ActionError({
      error: message, code: "certification_locked",
      issues: [{ path: ["orderId"], code: "certification_locked", message, meta: {
        reason: "in_use", deliveryCode: "DL-001", deliveryId: "delivery-1",
        deliveries: [{ id: "delivery-1", code: "DL-001" }, { id: "delivery-2", code: "DL-002" }, { id: "delivery-3", code: "DL-003" }],
      } }],
    }));
    render(<OrderList />);
    await confirmDelete();

    const dialog = within(screen.getByRole("dialog"));
    const links = dialog.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual(["Open delivery DL-001", "Open delivery DL-002", "Open delivery DL-003"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/deliveries?facility=f1&delivery=delivery-1", "/deliveries?facility=f1&delivery=delivery-2", "/deliveries?facility=f1&delivery=delivery-3",
    ]);
    expect(dialog.getByText(message)).toBeTruthy();
  });

  it("keeps any other refusal in the confirm dialog", async () => {
    harness.remove.mockRejectedValue(new Error("The order is busy. Try again in a moment."));
    render(<OrderList />);
    await confirmDelete();

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(dialog.getByText(/The order is busy/)).toBeTruthy();
    expect(screen.queryByText("OR-001 is in use")).toBeNull();
  });
});
