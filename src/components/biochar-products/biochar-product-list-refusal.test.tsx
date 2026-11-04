// @vitest-environment jsdom
/**
 * The list hands the form's refusal handler a failed create or update and
 * shows what it returns in the form's footer, including nothing (#1327 PR G).
 */
import { useEffect, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";

const state = vi.hoisted(() => ({
  edit: false,
  failure: new Error("boom"),
  submit: undefined as undefined | ((onRefusal: SaveRefusalHandler) => Promise<void>),
  footer: undefined as string | undefined,
  refusal: vi.fn(),
}));

vi.mock("@/hooks/use-facilities", async (importOriginal) => (await import("../../../tests/helpers/facility-lookup-mocks")).activeFacilityLookupModule(await importOriginal()));
vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => {
    if (state.edit && key === "biocharProduct") return ["p1", vi.fn()];
    if (state.edit && key === "mode") return ["edit", vi.fn()];
    return [null, vi.fn()];
  },
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "f1", facilities: [] }) }));
vi.mock("@/hooks/use-open-create-intent", () => ({
  useOpenCreateIntent: (open: () => void) => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (!state.edit) open(); }, []);
  },
}));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-record-locks", () => ({
  useRecordLocks: () => ({ locks: {} }),
  useRecordLock: () => ({ lock: undefined, status: "idle", retry: vi.fn(), retrying: false }),
}));
vi.mock("@/components/record-locks", () => ({
  recordLockSheetProps: () => ({}),
  recordLockTitleMark: () => null,
  RecordLockListNotice: () => null,
}));
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: [] }) }));
vi.mock("@/hooks/use-biochar-products", () => {
  const fail = () => ({ mutateAsync: async () => { throw state.failure; }, isPending: false });
  return {
    useBiocharProducts: () => ({ data: { items: [], total: 0, totalPages: 0 }, isLoading: false, error: null }),
    useBiocharProductStats: () => ({ data: undefined, isLoading: false, isError: false }),
    useBiocharProduct: () => ({ data: { id: "p1", version: 3, code: "BP-1", productionDate: "2026-09-01" }, isError: false }),
    useCreateBiocharProduct: fail,
    useUpdateBiocharProduct: fail,
    useDeleteBiocharProduct: fail,
  };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("./biochar-product-form", () => ({
  BiocharProductForm: (props: { onSubmit: (data: never, onRefusal: SaveRefusalHandler) => Promise<void>; errorMessage?: string }) => {
    state.submit = (onRefusal) => props.onSubmit({} as never, onRefusal);
    return <p role="alert">{props.errorMessage ?? "no footer"}</p>;
  },
}));
vi.mock("./product-read-details", () => ({ productSheetSections: () => [] }));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 0 }, BiocharProductArt: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/ui/data-table", () => {
  const Slot = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    DataTable: Object.assign(Slot, {
      Toolbar: Slot, Controls: Slot, Search: () => null, FilterSelect: () => null, ColumnVisibility: () => null, Pagination: () => null,
    }),
  };
});

import { BiocharProductList } from "./biochar-product-list";

beforeEach(() => { state.edit = false; state.submit = undefined; state.refusal.mockReset(); });
afterEach(cleanup);

const FALLBACK_CREATE = "boom";

describe.each([
  ["create", false],
  ["update", true],
])("BiocharProductList %s refusal", (_name, edit) => {
  it("shows the footer the handler returns", async () => {
    state.edit = edit;
    state.refusal.mockReturnValue("Locked reason.");
    render(<BiocharProductList />);
    await waitFor(() => expect(state.submit).toBeDefined());
    await state.submit!(state.refusal);
    expect(await screen.findByText("Locked reason.")).toBeTruthy();
    expect(state.refusal).toHaveBeenCalledWith(state.failure, FALLBACK_CREATE);
  });

  it("shows no footer when the handler files every issue at its field", async () => {
    state.edit = edit;
    state.refusal.mockReturnValue(null);
    render(<BiocharProductList />);
    await waitFor(() => expect(state.submit).toBeDefined());
    await state.submit!(state.refusal);
    expect(state.refusal).toHaveBeenCalledOnce();
    expect(await screen.findByText("no footer")).toBeTruthy();
  });
});
