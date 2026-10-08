import type { ButtonHTMLAttributes, ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError, staleDeleteMessage } from "@/lib/stale-version";

const INITIAL_VERSION = 1;
const REFRESHED_VERSION = 2;
const state = vi.hoisted(() => ({ row: { id: "record", code: "RECORD-1", version: 1 }, remove: vi.fn() }));
vi.mock("nuqs", () => ({ parseAsString: { withOptions: () => ({}) }, useQueryState: () => [null, vi.fn()] }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "facility", facilities: [] }) }));
vi.mock("@/hooks/use-production-runs", () => ({
  useProductionRuns: () => ({ data: { items: [state.row], totalPages: 1 } }),
  useProductionRun: () => ({}), useProductionRunStats: () => ({}),
  useCreateProductionRun: () => ({}), useUpdateProductionRun: () => ({}),
  useDeleteProductionRun: () => ({ mutateAsync: state.remove }),
}));
vi.mock("@/hooks/use-biochar-products", () => ({
  useBiocharProducts: () => ({ data: { items: [state.row], totalPages: 1 } }),
  useBiocharProduct: () => ({}), useCreateBiocharProduct: () => ({}), useUpdateBiocharProduct: () => ({}),
  useDeleteBiocharProduct: () => ({ mutateAsync: state.remove }),
}));
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: [] }) }));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: string) => value }));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 25, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-create-with-evidence", () => ({ useCreateWithEvidence: () => ({ reset: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: ({ message }: { message: string }) => <span data-testid="delete-error">{message}</span> }));
vi.mock("@/components/ui", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  EmptyState: () => null, PageHeader: () => null,
  RowActionsMenu: ({ actions }: { actions: Array<{ label: string; onSelect: () => void }> }) =>
    <div>{actions.map(action => <button key={action.label} aria-label={action.label} onClick={action.onSelect} />)}</div>,
}));
type Row = typeof state.row;
vi.mock("@/components/ui/data-table", () => ({
  DataTable: Object.assign(({ columns, data }: {
    columns: Array<{ id?: string; cell?: (context: { row: { original: Row } }) => ReactNode }>;
    data: Row[];
  }) => <div>{columns.find(column => column.id === "actions")?.cell?.({ row: { original: data[0] } })}</div>, {
    Toolbar: () => null, Search: () => null, Controls: () => null, FilterSelect: () => null,
    ColumnVisibility: () => null, Pagination: () => null,
  }),
}));
vi.mock("@/lib/biochar-composition", async () => import("@/lib/biochar-composition/composition"));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => Promise<void> }) =>
    isOpen ? <button aria-label="Confirm delete" onClick={onConfirm} /> : null,
}));
vi.mock("@/components/certification/entity-certify-readiness-badge", () => ({ EntityCertifyReadinessBadge: () => null }));
vi.mock("./production-run-form", () => ({ ProductionRunForm: () => null }));
vi.mock("./production-run-read-sections", () => ({ productionRunSheetSections: () => [], RunStatusBadge: () => null }));
vi.mock("./production-incident-table", () => ({ ProductionIncidentTable: () => null }));
vi.mock("./production-sample-table", () => ({ ProductionSampleTable: () => null }));
vi.mock("../biochar-products/biochar-product-form", () => ({ BiocharProductForm: () => null }));
vi.mock("../biochar-products/product-read-details", () => ({ productSheetSections: () => [] }));

import { ProductionRunList } from "./production-run-list";
import { BiocharProductList } from "../biochar-products/biochar-product-list";

beforeEach(() => {
  vi.clearAllMocks();
  state.row = { ...state.row, version: INITIAL_VERSION };
});

for (const [label, entity, idKey, Component] of [
  ["Production run", "productionRun", "productionRunId", ProductionRunList],
  ["Biochar product", "biocharProduct", "productId", BiocharProductList],
] as const) {
  describe(`${label} delete confirmation`, () => {
    it("closes a stale confirmation and reopens with the refetched version", async () => {
      state.remove.mockRejectedValueOnce(new StaleVersionError(STALE_VERSION_MESSAGE, {
        entity, id: state.row.id, code: STALE_VERSION_CONFLICT_CODE,
      })).mockResolvedValueOnce(undefined);
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(<Component />); });
      try {
        await act(async () => { renderer.root.findByProps({ "aria-label": "Delete" }).props.onClick(); });
        state.row = { ...state.row, version: REFRESHED_VERSION };
        await act(async () => { renderer.update(<Component />); });
        await act(async () => { await renderer.root.findByProps({ "aria-label": "Confirm delete" }).props.onClick(); });
        expect(state.remove).toHaveBeenLastCalledWith({ [idKey]: state.row.id, expectedVersion: INITIAL_VERSION });
        expect(renderer.root.findAllByProps({ "aria-label": "Confirm delete" })).toHaveLength(0);
        expect(renderer.root.findByProps({ "data-testid": "delete-error" }).children).toEqual([staleDeleteMessage(`${label} ${state.row.code}`)]);
        await act(async () => { renderer.root.findByProps({ "aria-label": "Delete" }).props.onClick(); });
        await act(async () => { await renderer.root.findByProps({ "aria-label": "Confirm delete" }).props.onClick(); });
        expect(state.remove).toHaveBeenLastCalledWith({ [idKey]: state.row.id, expectedVersion: REFRESHED_VERSION });
      } finally { await act(async () => renderer.unmount()); }
    });

    it("keeps an ordinary failure's confirmation open and shows the server message", async () => {
      state.remove.mockRejectedValueOnce(new Error("Deletion is blocked by linked records."));
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(<Component />); });
      try {
        await act(async () => { renderer.root.findByProps({ "aria-label": "Delete" }).props.onClick(); });
        await act(async () => { await renderer.root.findByProps({ "aria-label": "Confirm delete" }).props.onClick(); });
        expect(renderer.root.findAllByProps({ "aria-label": "Confirm delete" })).toHaveLength(1);
        expect(renderer.root.findByProps({ "data-testid": "delete-error" }).children).toEqual(["Deletion is blocked by linked records."]);
      } finally { await act(async () => renderer.unmount()); }
    });
  });
}
