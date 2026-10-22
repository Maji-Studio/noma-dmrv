// @vitest-environment jsdom
/**
 * A refused Sample delete shows the server's own reason inside the open
 * confirmation dialog, not on the page behind the modal.
 */
import type { ReactNode } from "react";
import type { CellContext } from "@tanstack/react-table";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { RecordLockView } from "@/lib/record-lock-view";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE, StaleVersionError, staleDeleteMessage } from "@/lib/stale-version";

const SAMPLE_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const FACILITY_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SAMPLE_ROW = { id: SAMPLE_ID, sampleCode: "SMP-26-001", creditBatchCode: null, facilityName: null, version: 3, updatedAt: new Date("2026-01-01T00:00:00.000Z") };
const OPEN_LOCK: RecordLockView = { level: "open", heldBy: [], usedBy: [], freeFields: [], howToFree: "", returnedBy: [] };
const REFUSAL = "This Sample's lab report is referenced by a certification review, so it cannot be deleted.";

const harness = vi.hoisted(() => ({
  deleteSample: vi.fn(),
  dialog: null as { isOpen: boolean; errorMessage?: string; onConfirm: () => Promise<void> } | null,
  columns: [] as Array<{ id?: string; cell?: unknown }>,
  rowActions: null as Array<{ label: string; onSelect?: () => void }> | null,
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: () => [null, () => Promise.resolve(new URLSearchParams())],
}));
vi.mock("@/hooks/use-samples", () => ({
  useSamples: () => ({ data: { items: [SAMPLE_ROW], total: 1, totalPages: 1 }, isLoading: false, error: null }),
  useSampleStats: () => ({ data: undefined, isLoading: false }),
  useSample: () => ({ data: undefined, error: null, isSuccess: true }),
  useCreateSample: () => ({ startDraft: vi.fn(), isPending: false, mutateAsync: vi.fn() }),
  useUpdateSample: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteSample: () => ({ isPending: false, mutateAsync: harness.deleteSample }),
}));
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: [], isLoading: false, error: null }) }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: FACILITY_ID }) }));
vi.mock("@/hooks/use-transport-legs", () => ({
  useTransportLegsForEntity: () => ({ data: [] }),
  useCreateTransportLeg: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: () => ({ isOpen: false, context: null, clear: vi.fn() }),
}));
vi.mock("@/hooks/use-create-with-evidence", () => ({
  useCreateWithEvidence: () => ({
    guardUpdate: () => false, reset: vi.fn(), confirmClose: () => true, runWhileFlushing: vi.fn(),
    handleCreate: vi.fn(), isFlushing: false, deferredAttachments: { attachments: [], retry: vi.fn(), remove: vi.fn() },
  }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/use-record-locks", () => ({
  useRecordLocks: () => ({ locks: { [SAMPLE_ID]: OPEN_LOCK }, statusOf: () => "ready", failed: false, retry: vi.fn(), retrying: false }),
  useRecordLock: () => ({ lock: OPEN_LOCK, status: "ready", retry: vi.fn(), retrying: false }),
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  EmptyState: () => null,
  PageHeader: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
  RowActionsMenu: ({ actions }: { actions: NonNullable<typeof harness.rowActions> }) => {
    harness.rowActions = actions;
    return null;
  },
}));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: ({ columns }: { columns: typeof harness.columns }) => {
    harness.columns = columns;
    return null;
  },
}));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/ui/loading-skeleton", () => ({ Skeleton: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({
  DeleteConfirmDialog: (props: NonNullable<typeof harness.dialog>) => {
    harness.dialog = props;
    return null;
  },
}));
vi.mock("@/components/forms", () => ({ ServerError: ({ message }: { message?: string }) => <p>{message}</p> }));
vi.mock("@/components/certification/entity-certify-readiness-badge", () => ({ EntityCertifyReadinessBadge: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("./sample-read-sections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sample-read-sections")>()),
  sampleSheetSections: () => [],
}));
vi.mock("./sample-documents-panel", () => ({ SampleDocumentsPanel: () => null }));
vi.mock("./sample-form", () => ({ SampleForm: () => null }));

import { SampleList } from "./sample-list";

async function openDelete() {
  let page!: ReturnType<typeof create>;
  await act(async () => { page = create(<SampleList />); });
  const cell = harness.columns.find((entry) => entry.id === "actions")?.cell as (context: CellContext<typeof SAMPLE_ROW, unknown>) => ReactNode;
  await act(async () => {
    create(<>{cell({ row: { original: SAMPLE_ROW } } as CellContext<typeof SAMPLE_ROW, unknown>)}</>);
  });
  act(() => { harness.rowActions?.find((action) => action.label === "Delete")?.onSelect?.(); });
  expect(harness.dialog?.isOpen).toBe(true);
  expect(harness.dialog?.errorMessage).toBeUndefined();
  return page;
}

describe("Sample delete refusal", () => {
  it("shows the server's reason inside the open dialog and nowhere else", async () => {
    harness.deleteSample.mockRejectedValue(new Error(REFUSAL));
    const page = await openDelete();

    await act(async () => { await harness.dialog?.onConfirm(); });

    expect(harness.deleteSample).toHaveBeenCalledWith({ sampleId: SAMPLE_ID, expectedVersion: 3 });
    expect(harness.dialog?.isOpen).toBe(true);
    expect(harness.dialog?.errorMessage).toBe(REFUSAL);
    expect(JSON.stringify(page.toJSON())).not.toContain(REFUSAL);
    page.unmount();
  });

  it("closes the dialog on a stale refusal and says so on the page", async () => {
    harness.deleteSample.mockRejectedValue(
      new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "sample", id: SAMPLE_ID, code: STALE_VERSION_CONFLICT_CODE }),
    );
    const page = await openDelete();

    await act(async () => { await harness.dialog?.onConfirm(); });

    expect(harness.dialog?.isOpen).toBe(false);
    expect(harness.dialog?.errorMessage).toBeUndefined();
    expect(JSON.stringify(page.toJSON())).toContain(staleDeleteMessage("Sample"));
    page.unmount();
  });
});
