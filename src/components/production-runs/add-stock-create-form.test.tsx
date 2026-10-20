import type { ButtonHTMLAttributes, ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// An "adding stock" link opens the create sheet before the bin it names is read.
// These tests drive both lists through that window: the form must mount once,
// with the bin, and never remount under what the operator typed.
const BIN_ID = "44444444-4444-4444-8444-444444444444";
const state = vi.hoisted(() => ({
  bin: null as { storageLocationId: string; formulationId: string | null } | null,
  settling: false,
  onOpen: null as ((context: string | null) => void) | null,
  mounts: 0,
}));
vi.mock("nuqs", () => ({ parseAsString: { withOptions: () => ({}) }, useQueryState: () => [null, vi.fn()] }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "facility", facilities: [] }) }));
vi.mock("@/hooks/use-production-runs", () => ({
  useProductionRuns: () => ({ data: { items: [], totalPages: 1 } }),
  useProductionRun: () => ({}), useProductionRunStats: () => ({}),
  useCreateProductionRun: () => ({ startDraft: vi.fn() }), useUpdateProductionRun: () => ({}), useDeleteProductionRun: () => ({}),
}));
vi.mock("@/hooks/use-biochar-products", () => ({
  useBiocharProducts: () => ({ data: { items: [], totalPages: 1 } }),
  useBiocharProduct: () => ({}), useCreateBiocharProduct: () => ({}), useUpdateBiocharProduct: () => ({}), useDeleteBiocharProduct: () => ({}),
}));
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: [] }) }));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: string) => value }));
vi.mock("@/hooks/use-record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).openRecordLocksModule);
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: (options: { onOpen?: (context: string | null) => void }) => { state.onOpen = options.onOpen ?? null; },
}));
vi.mock("@/hooks/use-add-stock-bin", () => ({
  useAddStockBin: () => ({ bin: state.bin, settling: state.settling, request: vi.fn(), clear: vi.fn() }),
}));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 25, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-create-with-evidence", () => ({ useCreateWithEvidence: () => ({ reset: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("@/components/ui", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  EmptyState: () => null, PageHeader: () => null, RowActionsMenu: () => null,
}));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: Object.assign(() => null, {
    Toolbar: () => null, Search: () => null, Controls: () => null, FilterSelect: () => null,
    ColumnVisibility: () => null, Pagination: () => null,
  }),
}));
vi.mock("@/lib/biochar-composition", async () => import("@/lib/biochar-composition/composition"));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <>{children}</> : null),
}));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/certification/entity-certify-readiness-badge", () => ({ EntityCertifyReadinessBadge: () => null }));
/** A create form that keeps what was typed for as long as it stays mounted, and counts its mounts. */
async function formStub() {
  const { useState } = await import("react");
  return function CreateFormStub(props: { initialBin?: { storageLocationId: string } | null; initialBiocharStorageLocationId?: string }) {
    const [opening] = useState(() => { state.mounts += 1; return props.initialBin?.storageLocationId ?? props.initialBiocharStorageLocationId ?? ""; });
    const [typed, setTyped] = useState("");
    return <input aria-label="Typed" data-opening-bin={opening} value={typed} onChange={(event) => setTyped(event.target.value)} />;
  };
}
vi.mock("./production-run-form", async () => ({ ProductionRunForm: await formStub() }));
vi.mock("../biochar-products/biochar-product-form", async () => ({ BiocharProductForm: await formStub() }));
vi.mock("./production-run-read-sections", () => ({ productionRunSheetSections: () => [], RunStatusBadge: () => null }));
vi.mock("./production-incident-table", () => ({ ProductionIncidentTable: () => null }));
vi.mock("./production-sample-table", () => ({ ProductionSampleTable: () => null }));
vi.mock("../biochar-products/product-read-details", () => ({ productSheetSections: () => [] }));

import { ProductionRunList } from "./production-run-list";
import { BiocharProductList } from "../biochar-products/biochar-product-list";

beforeEach(() => {
  state.bin = null;
  state.settling = false;
  state.onOpen = null;
  state.mounts = 0;
});

const typedInputs = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.type === "input" && node.props["aria-label"] === "Typed");
const loading = (renderer: ReactTestRenderer) => renderer.root.findAll((node) => node.props.role === "status");

for (const [label, Component] of [["Production run", ProductionRunList], ["Biochar product", BiocharProductList]] as const) {
  describe(`${label} create form from an adding stock link`, () => {
    it("holds the form until the bin is read, then keeps typed input through a refetch", async () => {
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(<Component />); });
      try {
        state.settling = true;
        await act(async () => { state.onOpen?.(BIN_ID); });
        // Nothing to type into yet: the sheet shows that the bin is loading.
        expect(typedInputs(renderer)).toHaveLength(0);
        expect(loading(renderer)).toHaveLength(1);

        state.settling = false;
        state.bin = { storageLocationId: BIN_ID, formulationId: null };
        await act(async () => { renderer.update(<Component />); });
        const [input] = typedInputs(renderer);
        expect(input.props["data-opening-bin"]).toBe(BIN_ID);
        await act(async () => { input.props.onChange({ target: { value: "typed by the operator" } }); });

        // A refetch that no longer offers the bin (say it was archived) leaves the open form alone.
        state.bin = null;
        await act(async () => { renderer.update(<Component />); });
        expect(typedInputs(renderer)[0].props.value).toBe("typed by the operator");
        expect(state.mounts).toBe(1);
      } finally { await act(async () => renderer.unmount()); }
    });

    it("opens the form at once when the link names no bin", async () => {
      let renderer!: ReactTestRenderer;
      await act(async () => { renderer = create(<Component />); });
      try {
        await act(async () => { state.onOpen?.(null); });
        expect(loading(renderer)).toHaveLength(0);
        expect(typedInputs(renderer)).toHaveLength(1);
      } finally { await act(async () => renderer.unmount()); }
    });
  });
}
