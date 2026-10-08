import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { CreditBatchList } from "./credit-batch-list";

const harness = vi.hoisted(() => ({
  remove: vi.fn(), error: vi.fn(), success: vi.fn(),
  onDelete: undefined as ((id: string) => void) | undefined,
  onConfirm: undefined as (() => Promise<void>) | undefined,
  batch: { id: "batch-1", version: 3, code: "CB-1", facilityId: "facility-1", startDate: "2026-09-01", endDate: "2026-09-30" },
}));
vi.mock("nuqs", () => ({ parseAsString: { withOptions: () => ({}) }, useQueryState: () => [null, vi.fn()] }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "facility-1" }) }));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => ({ isOpen: false, clear: vi.fn() }) }));
vi.mock("@/hooks/use-list-pagination", () => ({ useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), setPageSize: vi.fn() }) }));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatches: () => ({ data: [harness.batch] }),
  useCreditBatch: () => ({}),
  useCreditBatchCo2eStoredPreviews: () => ({ data: {} }),
  useCreditBatchProductionRunOptions: () => ({ data: [] }),
  useCreateCreditBatch: () => ({}),
  useUpdateCreditBatch: () => ({}),
  useDeleteCreditBatch: () => ({ mutateAsync: harness.remove }),
}));
vi.mock("@/hooks/use-certification", () => ({ useCreditBatchHealthSummaries: () => ({ data: {} }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: harness.error, success: harness.success }) }));
vi.mock("@/components/ui", () => ({ Button: () => null, EmptyState: () => null, ListPagination: () => null, PageHeader: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/ui/notice", () => ({ Notice: () => null }));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 48 }, CreditBatchArt: () => null }));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({ CertificateIcon: () => null, LeafIcon: () => null, PlusIcon: () => null }));
vi.mock("./credit-batch-form", () => ({ CreditBatchForm: () => null }));
vi.mock("./credit-batch-filters", () => ({ CreditBatchFilters: () => null }));
vi.mock("./credit-batch-health-strip", () => ({ CreditBatchHealthStrip: () => null }));
vi.mock("./credit-batch-durability-panel", () => ({ CreditBatchDurabilityPanel: () => null }));
vi.mock("./credit-batch-view", () => ({ creditBatchSheetSections: () => [] }));
vi.mock("./credit-batch-card", () => ({ CreditBatchCard: ({ onDelete }: { onDelete: (id: string) => void }) => {
  harness.onDelete = onDelete;
  return null;
} }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: ({ onConfirm }: { onConfirm: () => Promise<void> }) => {
  harness.onConfirm = onConfirm;
  return null;
} }));

it("shows the server's deletion refusal in the toast", async () => {
  const reason = "This credit batch is locked by a certification submission.";
  harness.remove.mockRejectedValueOnce(new Error(reason));
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = create(<CreditBatchList canManage />); });
    await act(async () => { harness.onDelete!(harness.batch.id); });
    await act(async () => { await harness.onConfirm!(); });
    expect(harness.remove).toHaveBeenCalledWith({ creditBatchId: harness.batch.id, expectedVersion: harness.batch.version });
    expect(harness.error).toHaveBeenCalledWith(reason);
    expect(harness.success).not.toHaveBeenCalled();
  } finally {
    await act(async () => renderer?.unmount());
  }
});
