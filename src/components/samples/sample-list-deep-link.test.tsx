import { STALE_VERSION_MESSAGE, STALE_VERSION_CONFLICT_CODE, StaleVersionError } from "@/lib/stale-version";
/**
 * A save from a deep-linked sample sheet works and closes it for good.
 *
 * `?sample=<id>&mode=edit` (the dashboard transport-gap link) renders the edit
 * form from the live detail query, so the local sheet state is empty. Save used
 * to resolve its target from that local state and silently did nothing. It now
 * resolves from the displayed sheet and clears the retained params on success.
 */

import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SampleList } from "./sample-list";

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
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  FlaskIcon: () => null,
  LeafIcon: () => null,
  PlusIcon: () => null,
  XIcon: () => null,
  FireIcon: () => null,
  CertificateIcon: () => null,
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  EmptyState: () => null,
  PageHeader: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
  RowActionsMenu: () => null,
}));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/ui/data-table", () => ({ DataTable: () => null }));
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
  }) => {
    harness.sheet = { open: props.open, mode: props.mode };
    harness.onModeChange = props.onModeChange;
    return props.open ? <div>{props.children}</div> : null;
  },
}));
vi.mock("./sample-read-sections", () => ({ sampleSheetSections: () => [] }));
vi.mock("./sample-form", () => ({
  SampleForm: (props: { onSubmit: SubmitHandler }) => {
    harness.onSubmit = props.onSubmit;
    return null;
  },
}));

const SAMPLE = {
  id: SAMPLE_ID,
  sampleCode: "SMP-26-001",
  creditBatchCode: null,
  facilityName: null,
  version: 1,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("SampleList deep-linked sheet", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    harness.sample = SAMPLE;
    harness.update.mockReset().mockResolvedValue(undefined);
    harness.onSubmit = null;
    harness.onModeChange = null;
  });

  it("saves and closes a sheet deep-linked straight into edit mode", async () => {
    harness.query = { sample: SAMPLE_ID, mode: "edit" };
    await act(async () => {
      renderer = create(<SampleList />);
    });
    expect(harness.sheet).toEqual({ open: true, mode: "edit" });

    await act(async () => {
      await harness.onSubmit?.({ notes: "Updated" });
    });
    await act(async () => {
      renderer?.update(<SampleList />);
    });

    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({ sampleId: SAMPLE_ID, expectedVersion: SAMPLE.version }));
    expect(harness.query.sample).toBeNull();
    expect(harness.query.mode).toBeNull();
    expect(harness.sheet.open).toBe(false);
    renderer?.unmount();
  });

  it("saves and closes after switching a deep-linked view sheet to edit", async () => {
    harness.query = { sample: SAMPLE_ID };
    await act(async () => {
      renderer = create(<SampleList />);
    });
    expect(harness.sheet).toEqual({ open: true, mode: "view" });

    await act(async () => {
      harness.onModeChange?.("edit");
    });
    expect(harness.sheet.mode).toBe("edit");

    await act(async () => {
      await harness.onSubmit?.({ notes: "Updated" });
    });
    await act(async () => {
      renderer?.update(<SampleList />);
    });

    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({ sampleId: SAMPLE_ID, expectedVersion: SAMPLE.version }));
    expect(harness.query.sample).toBeNull();
    expect(harness.sheet.open).toBe(false);
    renderer?.unmount();
  });
  it("keeps the opened version and draft sheet after a stale save even when details refetch", async () => {
    harness.query = { sample: SAMPLE_ID, mode: "edit" };
    harness.update.mockRejectedValue(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "sample", id: SAMPLE_ID, code: STALE_VERSION_CONFLICT_CODE }));
    await act(async () => { renderer = create(<SampleList />); });
    harness.sample = { ...SAMPLE, version: SAMPLE.version + 1 };
    await act(async () => { renderer?.update(<SampleList />); });
    const draft = { labName: "Unsaved draft" };
    await act(async () => { await harness.onSubmit?.(draft); });
    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({ ...draft, sampleId: SAMPLE_ID, expectedVersion: SAMPLE.version }));
    expect(harness.sheet).toEqual({ open: true, mode: "edit" });
    expect(harness.query.sample).toBe(SAMPLE_ID);
    renderer?.unmount();
  });

});
