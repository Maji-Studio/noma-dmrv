// @vitest-environment jsdom
/**
 * Delete for an Open delivery, from the row menu like products: one
 * confirmed request with the row's version, and no Delete once the delivery
 * is In use. The server restores the bin stock (record-lock-deletes test).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordLockView } from "@/lib/record-lock-view";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";

const DELIVERY_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const FACILITY_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const DELIVERY = {
  id: DELIVERY_ID,
  code: "DL-26-001",
  facilityId: FACILITY_ID,
  version: 3,
  status: "delivered",
  orderCode: "OR-26-001",
  customerName: "Demo farm",
  deliveryDate: "2026-09-22",
  deliveredWetMassKg: 1000,
  massDryKg: 450,
  moistureContentPercent: 20,
};

const harness = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  level: "open" as RecordLockView["level"],
  remove: vi.fn(),
  success: vi.fn(),
}));

function lockView(): RecordLockView {
  return { level: harness.level, heldBy: [], usedBy: [], freeFields: [], howToFree: null, returnedBy: [] };
}

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
vi.mock("@/hooks/use-deliveries", () => ({
  useDeliveries: () => ({ data: { items: [DELIVERY], total: 1, totalPages: 1 }, isLoading: false, error: null }),
  useDeliveryStats: () => ({ data: undefined, isLoading: false }),
  useDeliveryWithRelations: () => ({ data: undefined, error: null, isSuccess: false, isError: false }),
  useCreateDelivery: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateDelivery: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteDelivery: () => ({ isPending: false, mutateAsync: harness.remove }),
  useFetchDeliveryWithRelations: () => vi.fn(),
}));
vi.mock("@/hooks/use-record-locks", () => ({
  useRecordLocks: () => ({
    locks: new Proxy({}, { get: () => lockView() }),
    statusOf: () => "ready" as const,
    failed: false,
    retry: () => undefined,
    retrying: false,
  }),
  useRecordLock: () => ({ lock: lockView(), status: "ready" as const, retry: vi.fn(), retrying: false }),
}));
vi.mock("@/components/record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).stubRecordLockComponentsModule);
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: [] }) }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: FACILITY_ID, facilities: [] }),
}));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-create-with-evidence", () => ({
  useCreateWithEvidence: () => ({
    guardUpdate: () => false,
    reset: vi.fn(),
    confirmClose: () => true,
    handleCreate: vi.fn(),
    isFlushing: false,
    deferredAttachments: undefined,
  }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: harness.success, error: vi.fn() }) }));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  TruckIcon: () => null,
  ScalesIcon: () => null,
  PlusIcon: () => null,
  XIcon: () => null,
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  EmptyState: () => null,
  PageHeader: () => null,
  RowActionsMenu: ({ actions }: { actions: Array<{ label: string; onSelect: () => void }> }) => (
    <div data-testid="row-menu">
      {actions.map((action) => <button key={action.label} type="button" onClick={action.onSelect}>{action.label}</button>)}
    </div>
  ),
}));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: Object.assign(
    ({ columns, data }: {
      columns: Array<{ id?: string; cell?: (context: { row: { original: unknown } }) => ReactNode }>;
      data: unknown[];
    }) => (
      <div>
        {data.map((row, index) => (
          <div key={index}>
            {columns.find((column) => column.id === "actions")?.cell?.({ row: { original: row } })}
          </div>
        ))}
      </div>
    ),
    { Toolbar: () => null, Search: () => null, Controls: () => null, FilterSelect: () => null, ColumnVisibility: () => null, Pagination: () => null },
  ),
}));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/ui/mass-pair", () => ({ MassPair: () => null }));
vi.mock("@/components/forms", () => ({
  ServerError: ({ message }: { message?: string }) => (message ? <p data-testid="list-error">{message}</p> : null),
}));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/certification/entity-certify-readiness-badge", () => ({ EntityCertifyReadinessBadge: () => null }));
vi.mock("@/components/certification/certification-scope-header", () => ({ CertificationScopeHeader: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ isOpen, title, onConfirm, onCancel, errorMessage }: {
    isOpen: boolean; title: string; onConfirm: () => void; onCancel: () => void; errorMessage?: string;
  }) =>
    isOpen ? (
      <div role="alertdialog" aria-label={title}>
        {errorMessage && <p data-testid="dialog-error">{errorMessage}</p>}
        <button type="button" onClick={onConfirm}>Confirm delete</button>
        <button type="button" onClick={onCancel}>Cancel delete</button>
      </div>
    ) : null,
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("./delivery-read-sections", () => ({ deliverySheetSections: () => [] }));
vi.mock("./delivery-form", () => ({ DeliveryForm: () => null }));

import { DeliveryList } from "./delivery-list";

beforeEach(() => {
  harness.query = {};
  harness.level = "open";
  harness.remove.mockReset().mockResolvedValue(undefined);
  harness.success.mockReset();
});
afterEach(cleanup);

describe("DeliveryList delete", () => {
  it("deletes an Open delivery from the row menu once, with its version, after confirmation", async () => {
    render(<DeliveryList />);
    const menu = screen.getByTestId("row-menu");
    expect([...menu.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Edit", "Delete"]);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(harness.remove).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Delete delivery" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    });
    expect(harness.remove).toHaveBeenCalledTimes(1);
    expect(harness.remove).toHaveBeenCalledWith({ deliveryId: DELIVERY_ID, expectedVersion: 3 });
    expect(harness.success).toHaveBeenCalledWith("Delivery deleted.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("offers no Delete for an In use delivery", () => {
    harness.level = "inUse";
    render(<DeliveryList />);
    expect([...screen.getByTestId("row-menu").querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Edit"]);
  });

  it("keeps the confirmation open with the refusal", async () => {
    harness.remove.mockRejectedValue(new Error("This delivery cannot be deleted."));
    render(<DeliveryList />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    });
    expect(screen.getByTestId("dialog-error").textContent).toBe("This delivery cannot be deleted.");
    expect(screen.queryByTestId("list-error")).toBeNull();
  });

  it("opens the next confirmation without the previous stale message", async () => {
    harness.remove.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "delivery", id: DELIVERY_ID, code: STALE_VERSION_CONFLICT_CODE }));
    render(<DeliveryList />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("list-error").textContent).toContain("Delivery DL-26-001 was not deleted.");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog", { name: "Delete delivery" })).toBeTruthy();
    expect(screen.queryByTestId("dialog-error")).toBeNull();
    expect(screen.queryByTestId("list-error")).toBeNull();
  });
});
