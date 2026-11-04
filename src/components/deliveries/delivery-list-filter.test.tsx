// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordLockView } from "@/lib/record-lock-view";


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
  list: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
}));

function lockView(): RecordLockView {
  return { level: harness.level, heldBy: [], usedBy: [], freeFields: [], howToFree: null, returnedBy: [] };
}

vi.mock("@/hooks/use-facilities", async (importOriginal) => (await import("../../../tests/helpers/facility-lookup-mocks")).activeFacilityLookupModule(await importOriginal()));
vi.mock("@/components/forms/use-documents-cert-status", () => ({ useDocumentsCertStatus: () => "neutral" }));
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
  useDeliveries: (filters: unknown) => {
    harness.list(filters);
    return { data: { items: [DELIVERY], total: 1, totalPages: 1 }, isLoading: false, error: null };
  },
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
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
  EmptyState: () => null,
  PageHeader: () => null,
  RowActionsMenu: ({ actions }: { actions: Array<{ label: string; onSelect: () => void }> }) => (
    <div data-testid="row-menu">
      {actions.map((action) => <button key={action.label} type="button" onClick={action.onSelect}>{action.label}</button>)}
    </div>
  ),
}));
vi.mock("@/components/ui/data-table", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { DataTable: Object.assign(Container, {
    Toolbar: Container, Controls: Container, Search: () => null,
    FilterSelect: () => null, ColumnVisibility: () => null, Pagination: () => null,
  }) };
});
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
  harness.list.mockReset();
  harness.level = "open";
  harness.remove.mockReset().mockResolvedValue(undefined);
  harness.success.mockReset();
});
afterEach(cleanup);


describe("DeliveryList affected-record filter", () => {
  it.each([
    { ids: [DELIVERY_ID, FACILITY_ID], label: "2 affected deliveries" },
    { ids: [DELIVERY_ID], label: "1 affected delivery" },
  ])("shows $label and passes exact ids to the hook", ({ ids, label }) => {
    harness.query = { ids: ids.join(",") };
    render(<DeliveryList />);
    expect(screen.getByText(label)).toBeDefined();
    expect(harness.list).toHaveBeenLastCalledWith(expect.objectContaining({ ids, facilityId: FACILITY_ID }));
    expect(screen.getByRole("button", { name: "Clear" })).toBeDefined();
  });

  it("normalizes invalid and duplicate ids before filtering", () => {
    harness.query = { ids: `${DELIVERY_ID.toUpperCase()},invalid,${DELIVERY_ID}` };
    render(<DeliveryList />);
    expect(screen.getByText("1 affected delivery")).toBeDefined();
    expect(harness.query.ids).toBe(DELIVERY_ID);
    expect(harness.list).toHaveBeenLastCalledWith(expect.objectContaining({ ids: [DELIVERY_ID] }));
  });

  it("clears the affected ids with the other list filters", () => {
    harness.query = { ids: `${DELIVERY_ID},${FACILITY_ID}`, creditBatch: "batch" };
    const view = render(<DeliveryList />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(harness.query.ids).toBeNull();
    expect(harness.query.creditBatch).toBeNull();
    view.rerender(<DeliveryList />);
    expect(screen.queryByText("2 affected deliveries")).toBeNull();
    expect(harness.list).toHaveBeenLastCalledWith(expect.objectContaining({ ids: undefined, creditBatchId: undefined }));
  });
});
