/**
 * A deep-linked supplier edit saves against the version it opened on (#768).
 *
 * `?supplier=<id>&mode=edit` (the dashboard gap link) opens the sheet from the
 * live detail query. A location save or a refused stale save refetches that
 * query while the operator's draft stays put, so the sheet must keep the copy
 * it opened on: otherwise the next save carries the newer `updatedAt` and
 * silently overwrites a colleague's edit.
 */

import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SupplierList } from "./supplier-list";

const SUPPLIER_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const OPENED_AT = new Date("2026-01-01T00:00:00.000Z");
const REFETCHED_AT = new Date("2026-01-02T00:00:00.000Z");

type SubmitHandler = (data: Record<string, unknown>) => Promise<void>;

const harness = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  supplier: null as Record<string, unknown> | null,
  update: vi.fn(),
  onSubmit: null as SubmitHandler | null,
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [harness.query[key] ?? null, vi.fn()],
}));
vi.mock("@/hooks/use-suppliers", () => ({
  useSuppliers: () => ({ data: { items: [], total: 0, totalPages: 0 }, isLoading: false, error: null }),
  useSupplier: () => ({ data: harness.supplier, isLoading: false, isFetching: false, isPending: false, isSuccess: true, isError: false }),
  useSupplierLocationsBySupplier: () => ({ data: [], isLoading: false }),
  useCreateSupplierWithLocations: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateSupplier: () => ({ isPending: false, mutateAsync: harness.update }),
  useDeleteSupplier: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({ UsersIcon: () => null, PlusIcon: () => null }));
vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  EmptyState: () => null,
  PageHeader: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
  RowActionsMenu: () => null,
}));
vi.mock("@/components/ui/data-table", () => ({ DataTable: () => null }));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div>{children}</div> : null),
}));
vi.mock("./supplier-read-sections", () => ({ supplierSheetSections: () => [] }));
vi.mock("./supplier-form", () => ({
  SupplierForm: (props: { onSubmit: SubmitHandler }) => {
    harness.onSubmit = props.onSubmit;
    return null;
  },
}));

function supplierAt(updatedAt: Date) {
  return { id: SUPPLIER_ID, code: "SUP-26-001", name: "Supplier", updatedAt, locationCount: 0 };
}

describe("SupplierList deep-linked edit", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    harness.query = { supplier: SUPPLIER_ID, mode: "edit" };
    harness.supplier = supplierAt(OPENED_AT);
    harness.update.mockReset().mockResolvedValue(undefined);
    harness.onSubmit = null;
  });

  it("saves against the version the sheet opened on, not a refetched one", async () => {
    await act(async () => {
      renderer = create(<SupplierList />);
    });
    expect(harness.onSubmit).not.toBeNull();

    // A location save (or a refused stale save) refetches the detail query.
    harness.supplier = supplierAt(REFETCHED_AT);
    await act(async () => {
      renderer?.update(<SupplierList />);
    });

    await act(async () => {
      await harness.onSubmit?.({ name: "Operator's draft" });
    });

    expect(harness.update).toHaveBeenCalledWith(
      expect.objectContaining({ supplierId: SUPPLIER_ID, expectedUpdatedAt: OPENED_AT }),
    );
    renderer?.unmount();
  });
});
