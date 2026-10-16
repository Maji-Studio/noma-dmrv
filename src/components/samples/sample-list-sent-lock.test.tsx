// @vitest-environment jsdom
/**
 * Sample sheet behind a Sent Removal (#687 item 2, #1119): neither Edit nor
 * Delete is offered, and the sheet says which Removal holds it and why.
 */
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";


const SAMPLE_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const FACILITY_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

type SubmitHandler = (data: Record<string, unknown>) => Promise<void>;
type ModeChange = (mode: "view" | "edit" | "create") => void;

const harness = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  sample: null as Record<string, unknown> | null,
  update: vi.fn(),
  onSubmit: null as SubmitHandler | null,
  onModeChange: null as ModeChange | null,
  sheet: { open: false, mode: "view" as string },
  lock: undefined as RecordLockView | undefined,
  sheetProps: null as Record<string, unknown> | null,
  columns: [] as Array<{ id?: string; cell?: unknown }>,
  rowActions: null as Array<{ label: string }> | null,
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
  useSamples: () => ({ data: { items: [], total: 0, totalPages: 0 }, isLoading: false, error: null }),
  useSampleStats: () => ({ data: undefined, isLoading: false }),
  useSample: () => ({
    data: harness.query.sample ? harness.sample : undefined,
    error: null,
    isSuccess: true,
  }),
  useCreateSample: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateSample: () => ({ isPending: false, mutateAsync: harness.update }),
  useDeleteSample: () => ({ isPending: false, mutateAsync: vi.fn() }),
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
  useRecordLocks: () => ({ locks: harness.lock ? { [SAMPLE_ID]: harness.lock } : {} }),
  useRecordLock: (_kind: string, id: string | null | undefined) => ({ lock: id ? harness.lock : undefined, isLoading: false }),
}));

vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  EmptyState: () => null,
  PageHeader: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
  RowActionsMenu: ({ actions }: { actions: Array<{ label: string }> }) => {
    harness.rowActions = actions;
    return null;
  },
}));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: ({ columns }: { columns: Array<{ id?: string; cell?: unknown }> }) => {
    harness.columns = columns;
    return null;
  },
}));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/ui/loading-skeleton", () => ({ Skeleton: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
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
    viewModeNotice?: ReactNode;
    titleBadge?: ReactNode;
  }) => {
    harness.sheet = { open: props.open, mode: props.mode };
    harness.sheetProps = props;
    harness.onModeChange = props.onModeChange;
    return props.open ? <div>{props.titleBadge}{props.mode === "view" ? props.viewModeNotice : props.children}</div> : null;
  },
}));
vi.mock("./sample-read-sections", () => ({ sampleSheetSections: () => [] }));
vi.mock("./sample-form", () => ({
  SampleForm: (props: { onSubmit: SubmitHandler }) => {
    harness.onSubmit = props.onSubmit;
    return null;
  },
}));

import type { CellContext } from "@tanstack/react-table";
import type { RecordLockView } from "@/lib/record-lock-view";
import { SampleList } from "./sample-list";

const REMOVAL_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const SAMPLE = {
  id: SAMPLE_ID,
  sampleCode: "SMP-26-001",
  creditBatchCode: null,
  facilityName: null,
  version: 1,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const SENT: RecordLockView = {
  level: "sent",
  heldBy: [{ kind: "removal", id: REMOVAL_ID, label: null, facilityId: FACILITY_ID, period: { startedOn: "2026-01-01", completedOn: "2026-03-31" } }],
  usedBy: [{ kind: "removal", id: REMOVAL_ID, label: null, facilityId: FACILITY_ID, period: { startedOn: "2026-01-01", completedOn: "2026-03-31" } }],
  freeFields: [],
  howToFree: "Wait for Isometric to return the covering GHG Statement, then refresh its status.",
  returnedBy: [],
};
const IN_USE: RecordLockView = { ...SENT, level: "inUse", howToFree: "Correct or remove the records that use it first." };

function textOf(renderer: ReactTestRenderer): string {
  const walk = (node: unknown): string => {
    if (node == null) return "";
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(walk).join("");
    return walk((node as { children?: unknown }).children);
  };
  return walk(renderer.toJSON());
}

function renderActionsCell() {
  const column = harness.columns.find((entry) => entry.id === "actions");
  const cell = column?.cell as ((context: CellContext<typeof SAMPLE, unknown>) => ReactNode) | undefined;
  harness.rowActions = null;
  let cellRenderer!: ReactTestRenderer;
  act(() => {
    cellRenderer = create(<>{cell?.({ row: { original: SAMPLE } } as CellContext<typeof SAMPLE, unknown>)}</>);
  });
  return cellRenderer;
}

describe("Sample sheet behind a Sent Removal", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    harness.sample = SAMPLE;
    harness.query = {};
    harness.lock = undefined;
    harness.sheetProps = null;
  });

  it("hides Edit on the sheet and states which Removal holds it", async () => {
    harness.lock = SENT;
    harness.query = { sample: SAMPLE_ID };
    await act(async () => { renderer = create(<SampleList />); });

    expect(harness.sheet).toEqual({ open: true, mode: "view" });
    expect(harness.sheetProps?.canEdit).toBe(false);
    const text = textOf(renderer!);
    expect(text).toContain("Sent");
    expect(text).toContain("Sent with Removal Jan 1 to Mar 31, 2026, so every field is locked.");
    expect(text).toContain("Wait for Isometric to return the covering GHG Statement, then refresh its status.");
    const link = renderer!.root.findByType("a");
    expect(link.props.href).toBe(`/certification/removals?facility=${FACILITY_ID}&removal=${REMOVAL_ID}`);
    renderer?.unmount();
  });

  it("opens an edit deep link in view mode while Sent", async () => {
    harness.lock = SENT;
    harness.query = { sample: SAMPLE_ID, mode: "edit" };
    await act(async () => { renderer = create(<SampleList />); });
    expect(harness.sheet).toEqual({ open: true, mode: "view" });
    renderer?.unmount();
  });

  it("offers no row actions while Sent", async () => {
    harness.lock = SENT;
    await act(async () => { renderer = create(<SampleList />); });
    const cell = renderActionsCell();
    expect(harness.rowActions).toBeNull();
    cell.unmount();
    renderer?.unmount();
  });

  it("keeps Edit and Delete while In use, with no lock line", async () => {
    harness.lock = IN_USE;
    harness.query = { sample: SAMPLE_ID };
    await act(async () => { renderer = create(<SampleList />); });
    expect(harness.sheetProps?.canEdit).toBe(true);
    expect(textOf(renderer!)).not.toContain("so every field is locked");
    const cell = renderActionsCell();
    expect(harness.rowActions?.map((action) => action.label)).toEqual(["Edit", "Delete"]);
    cell.unmount();
    renderer?.unmount();
  });
});
