// @vitest-environment jsdom
/**
 * A refused Sample delete shows the server's own reason inside the open
 * confirmation dialog, not on the page behind the modal.
 */
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";


const SAMPLE_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const FACILITY_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SAMPLE_ROW = { id: SAMPLE_ID, sampleCode: "SMP-26-001", creditBatchCode: null, facilityName: null, version: 3, updatedAt: new Date("2026-01-01T00:00:00.000Z") };

type SubmitHandler = (data: Record<string, unknown>) => Promise<void>;
type ModeChange = (mode: "view" | "edit" | "create") => void;

const harness = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  sample: null as Record<string, unknown> | null,
  update: vi.fn(),
  deleteSample: vi.fn(),
  dialog: null as { isOpen: boolean; errorMessage?: string; onConfirm: () => Promise<void> } | null,
  onSubmit: null as SubmitHandler | null,
  onModeChange: null as ModeChange | null,
  sheet: { open: false, mode: "view" as string },
  lock: undefined as RecordLockView | undefined,
  lockStatus: "ready" as "pending" | "error" | "ready",
  retry: vi.fn(),
  sheetProps: null as { canEdit?: boolean; submitBlock?: { retry?: { run: () => void } } | null } | null,
  columns: [] as Array<{ id?: string; accessorKey?: string; header?: unknown; cell?: unknown }>,
  rowActions: null as Array<{ label: string; onSelect?: () => void }> | null,
}));

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
vi.mock("@/hooks/use-samples", () => ({
  useSamples: () => ({ data: { items: [SAMPLE_ROW], total: 1, totalPages: 1 }, isLoading: false, error: null }),
  useSampleStats: () => ({ data: undefined, isLoading: false }),
  useSample: () => ({
    data: harness.query.sample ? harness.sample : undefined,
    error: null,
    isSuccess: true,
  }),
  useCreateSample: () => ({ startDraft: vi.fn(), isPending: false, mutateAsync: vi.fn() }),
  useUpdateSample: () => ({ isPending: false, mutateAsync: harness.update }),
  useDeleteSample: () => ({ isPending: false, mutateAsync: harness.deleteSample }),
}));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatches: () => ({ data: [], isLoading: false, error: null }),
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: FACILITY_ID }),
}));
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
    guardUpdate: () => false,
    reset: vi.fn(),
    confirmClose: () => true,
    runWhileFlushing: vi.fn(),
    handleCreate: vi.fn(),
    isFlushing: false,
    deferredAttachments: { attachments: [], retry: vi.fn(), remove: vi.fn() },
  }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

vi.mock("@/hooks/use-record-locks", () => ({
  useRecordLocks: () => ({ locks: harness.lock ? { [SAMPLE_ID]: harness.lock } : {}, statusOf: () => harness.lockStatus, failed: harness.lockStatus === "error", retry: harness.retry, retrying: false }),
  useRecordLock: (_kind: string, id: string | null | undefined) => ({ lock: id ? harness.lock : undefined, status: harness.lockStatus, retry: harness.retry, retrying: false }),
}));

vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  EmptyState: () => null,
  PageHeader: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
  RowActionsMenu: ({ actions }: { actions: Array<{ label: string; onSelect?: () => void }> }) => {
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
vi.mock("@/components/certification/entity-certify-readiness-badge", () => ({
  EntityCertifyReadinessBadge: () => null,
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: (props: {
    open: boolean;
    mode: string;
    onModeChange: ModeChange;
    children?: ReactNode;
    canEdit?: boolean;
    submitBlock?: { reason: string; tone: string; readOnly: boolean; retry?: { label: string; run: () => void } } | null;
    viewModeNotice?: ReactNode;
    titleBadge?: ReactNode;
  }) => {
    harness.sheet = { open: props.open, mode: props.mode };
    harness.sheetProps = props;
    harness.onModeChange = props.onModeChange;
    return props.open ? <div>{props.titleBadge}{props.mode === "view" ? props.viewModeNotice : props.children}</div> : null;
  },
}));
vi.mock("./sample-read-sections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sample-read-sections")>()),
  sampleSheetSections: () => [],
}));
vi.mock("./sample-documents-panel", () => ({ SampleDocumentsPanel: () => null }));
vi.mock("./sample-form", () => ({
  SampleForm: (props: { onSubmit: SubmitHandler }) => {
    harness.onSubmit = props.onSubmit;
    return null;
  },
}));

import type { CellContext } from "@tanstack/react-table";
import type { RecordLockView } from "@/lib/record-lock-view";
import { SampleList } from "./sample-list";

const OPEN_LOCK: RecordLockView = { level: "open", heldBy: [], usedBy: [], freeFields: [], howToFree: "", returnedBy: [] };
const REFUSAL = "This Sample's lab report is referenced by a certification review, so it cannot be deleted.";

describe("Sample delete refusal", () => {
  it("shows the server's reason inside the open dialog and nowhere else", async () => {
    harness.query = {};
    harness.lock = OPEN_LOCK;
    harness.deleteSample.mockRejectedValue(new Error(REFUSAL));
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<SampleList />); });

    const column = harness.columns.find((entry) => entry.id === "actions");
    const cell = column?.cell as (context: CellContext<typeof SAMPLE_ROW, unknown>) => ReactNode;
    await act(async () => {
      create(<>{cell({ row: { original: SAMPLE_ROW } } as CellContext<typeof SAMPLE_ROW, unknown>)}</>);
    });
    act(() => { harness.rowActions?.find((action) => action.label === "Delete")?.onSelect?.(); });
    expect(harness.dialog?.isOpen).toBe(true);
    expect(harness.dialog?.errorMessage).toBeUndefined();

    await act(async () => { await harness.dialog?.onConfirm(); });

    expect(harness.deleteSample).toHaveBeenCalledWith({ sampleId: SAMPLE_ID, expectedVersion: 3 });
    expect(harness.dialog?.isOpen).toBe(true);
    expect(harness.dialog?.errorMessage).toBe(REFUSAL);
    expect(JSON.stringify(renderer.toJSON())).not.toContain(REFUSAL);
    renderer.unmount();
  });
});
