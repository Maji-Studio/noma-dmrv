import { STALE_VERSION_MESSAGE, STALE_VERSION_CONFLICT_CODE, StaleVersionError } from "@/lib/stale-version";
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryList } from "./delivery-list";

const DELIVERY_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";
const FACILITY_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

type SubmitHandler = (data: Record<string, unknown>) => Promise<void>;
type ModeChange = (mode: "view" | "edit" | "create") => void;

const harness = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  delivery: null as Record<string, unknown> | null,
  update: vi.fn(),
  onSubmit: null as SubmitHandler | null,
  onModeChange: null as ModeChange | null,
  sheet: { open: false, mode: "view" as string },
  formError: undefined as string | undefined,
  formDelivery: null as Record<string, unknown> | null,
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
vi.mock("@/hooks/use-deliveries", () => ({
  useDeliveries: () => ({ data: { items: [], total: 0, totalPages: 0 }, isLoading: false, error: null }),
  useDeliveryStats: () => ({ data: undefined, isLoading: false }),
  useDeliveryWithRelations: () => ({
    data: harness.query.delivery ? harness.delivery : undefined,
    error: null,
    isSuccess: true,
  }),
  useCreateDelivery: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUpdateDelivery: () => ({ isPending: false, mutateAsync: harness.update }),
}));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatches: () => ({ data: [], isLoading: false, error: null }),
}));
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
    runWhileFlushing: vi.fn(),
    handleCreate: vi.fn(),
    isFlushing: false,
    deferredAttachments: { attachments: [], retry: vi.fn(), remove: vi.fn() },
  }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  TruckIcon: () => null,
  CalendarIcon: () => null,
  ScalesIcon: () => null,
  PlusIcon: () => null,
  XIcon: () => null,
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
vi.mock("./delivery-read-sections", () => ({ deliverySheetSections: () => [] }));
vi.mock("./delivery-form", () => ({
  DeliveryForm: (props: { onSubmit: SubmitHandler; errorMessage?: string; delivery: Record<string, unknown> }) => {
    harness.formError = props.errorMessage;
    harness.formDelivery = props.delivery;
    harness.onSubmit = props.onSubmit;
    return null;
  },
}));

const DELIVERY = {
  id: DELIVERY_ID,
  code: "DL-26-001",
  creditBatchCode: null,
  facilityName: null,
  version: 1,
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("DeliveryList deep-linked sheet", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    harness.delivery = DELIVERY;
    harness.update.mockReset().mockResolvedValue(undefined);
    harness.onSubmit = null;
    harness.onModeChange = null;
  });

  it("saves and closes a sheet deep-linked straight into edit mode", async () => {
    harness.query = { delivery: DELIVERY_ID, mode: "edit" };
    await act(async () => {
      renderer = create(<DeliveryList />);
    });
    expect(harness.sheet).toEqual({ open: true, mode: "edit" });

    await act(async () => {
      await harness.onSubmit?.({ distanceNote: "Updated" });
    });
    await act(async () => {
      renderer?.update(<DeliveryList />);
    });

    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: DELIVERY_ID, expectedVersion: DELIVERY.version }));
    expect(harness.query.delivery).toBeNull();
    expect(harness.query.mode).toBeNull();
    expect(harness.sheet.open).toBe(false);
    renderer?.unmount();
  });

  it("saves and closes after switching a deep-linked view sheet to edit", async () => {
    harness.query = { delivery: DELIVERY_ID };
    await act(async () => {
      renderer = create(<DeliveryList />);
    });
    expect(harness.sheet).toEqual({ open: true, mode: "view" });

    await act(async () => {
      harness.onModeChange?.("edit");
    });
    expect(harness.sheet.mode).toBe("edit");

    await act(async () => {
      await harness.onSubmit?.({ distanceNote: "Updated" });
    });
    await act(async () => {
      renderer?.update(<DeliveryList />);
    });

    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: DELIVERY_ID, expectedVersion: DELIVERY.version }));
    expect(harness.query.delivery).toBeNull();
    expect(harness.sheet.open).toBe(false);
    renderer?.unmount();
  });
  it("keeps the opened version and draft sheet after a stale save even when details refetch", async () => {
    harness.query = { delivery: DELIVERY_ID, mode: "edit" };
    harness.update.mockImplementation(async ({ expectedVersion }) => {
      if (expectedVersion !== harness.delivery?.version) {
        throw new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "delivery", id: DELIVERY_ID, code: STALE_VERSION_CONFLICT_CODE });
      }
    });
    await act(async () => { renderer = create(<DeliveryList />); });
    harness.delivery = { ...DELIVERY, version: DELIVERY.version + 1 };
    await act(async () => { renderer?.update(<DeliveryList />); });
    const draft = { distanceNote: "Unsaved draft" };
    await act(async () => { await harness.onSubmit?.(draft); });
    expect(harness.update).toHaveBeenCalledWith(expect.objectContaining({ ...draft, deliveryId: DELIVERY_ID, expectedVersion: DELIVERY.version }));
    expect(harness.sheet).toEqual({ open: true, mode: "edit" });
    expect(harness.query.delivery).toBe(DELIVERY_ID);
    expect(harness.formError).toBe(STALE_VERSION_MESSAGE);
    expect(harness.formDelivery?.version).toBe(DELIVERY.version);
    // A retry must retain the same precondition too.
    await act(async () => { await harness.onSubmit?.(draft); });
    expect(harness.update).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: DELIVERY.version }));
    renderer?.unmount();
  });

});
