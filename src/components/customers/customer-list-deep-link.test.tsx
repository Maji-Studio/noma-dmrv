/**
 * A save from a deep-linked customer sheet closes it for good.
 *
 * `?customer=<id>` opens the read sheet from the live detail query. Saving an
 * edit used to clear only the local sheet state, so the retained param brought
 * the read sheet straight back. Creating a customer while a param was retained
 * had the same effect on an older customer.
 */

import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerList } from "./customer-list";

const CUSTOMER_ID = "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f";

type SubmitHandler = (data: Record<string, unknown>) => Promise<void>;
type ModeChange = (mode: "view" | "edit" | "create") => void;

const harness = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  customer: null as Record<string, unknown> | null,
  update: vi.fn(),
  create: vi.fn(),
  onSubmit: null as SubmitHandler | null,
  onModeChange: null as ModeChange | null,
  sheet: { open: false, mode: "view" as string },
  openCreate: null as (() => void) | null,
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
vi.mock("@/hooks/use-customers", () => ({
  useCustomers: () => ({ data: { items: [], total: 0, totalPages: 0 }, isLoading: false, error: null }),
  useCustomerWithRelations: () => ({
    data: harness.query.customer ? harness.customer : undefined,
    isLoading: false,
    isFetching: false,
    isPending: false,
    isSuccess: true,
    isError: false,
  }),
  useCustomerLocations: () => ({ data: [] }),
  useCreateCustomerWithLocations: () => ({ isPending: false, mutateAsync: harness.create }),
  useUpdateCustomer: () => ({ isPending: false, mutateAsync: harness.update }),
  useDeleteCustomer: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: (open: () => void) => {
    harness.openCreate = open;
  },
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@phosphor-icons/react/dist/ssr", () => ({ UsersIcon: () => null, PlusIcon: () => null, MapTrifoldIcon: () => null }));
vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  EmptyState: () => null,
  PageHeader: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
  RowActionsMenu: () => null,
}));
vi.mock("@/components/ui/data-table", () => ({ DataTable: () => null }));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/ui/notice", () => ({ Notice: () => null }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
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
vi.mock("./customer-read-sections", () => ({ customerSheetSections: () => [] }));
vi.mock("./customer-form", () => ({
  CustomerForm: (props: { onSubmit: SubmitHandler }) => {
    harness.onSubmit = props.onSubmit;
    return null;
  },
}));

const CUSTOMER = {
  id: CUSTOMER_ID,
  code: "CUS-26-001",
  name: "Customer",
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  locations: [],
};

describe("CustomerList deep-linked sheet", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    harness.query = { customer: CUSTOMER_ID };
    harness.customer = CUSTOMER;
    harness.update.mockReset().mockResolvedValue(undefined);
    harness.create.mockReset().mockResolvedValue(undefined);
    harness.onSubmit = null;
    harness.onModeChange = null;
  });

  it("stays closed after saving an edit opened from a deep link", async () => {
    await act(async () => {
      renderer = create(<CustomerList />);
    });
    expect(harness.sheet).toEqual({ open: true, mode: "view" });

    await act(async () => {
      harness.onModeChange?.("edit");
    });
    expect(harness.sheet.mode).toBe("edit");

    await act(async () => {
      await harness.onSubmit?.({ name: "Renamed" });
    });
    await act(async () => {
      renderer?.update(<CustomerList />);
    });

    expect(harness.update).toHaveBeenCalled();
    expect(harness.query.customer).toBeNull();
    expect(harness.sheet.open).toBe(false);
    renderer?.unmount();
  });

  it("stays closed after creating a customer while an older one is deep-linked", async () => {
    await act(async () => {
      renderer = create(<CustomerList />);
    });
    await act(async () => {
      harness.openCreate?.();
    });
    expect(harness.sheet).toEqual({ open: true, mode: "create" });

    await act(async () => {
      await harness.onSubmit?.({ name: "New customer" });
    });
    await act(async () => {
      renderer?.update(<CustomerList />);
    });

    expect(harness.create).toHaveBeenCalled();
    expect(harness.query.customer).toBeNull();
    expect(harness.sheet.open).toBe(false);
    renderer?.unmount();
  });
});
