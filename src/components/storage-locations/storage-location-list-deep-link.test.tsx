// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkedSheet } from "../../../tests/helpers/linked-sheet-mocks";

const FACILITY = "facility-1";
const BIN = { id: "bin-1", code: "BIN-001", name: "Bin one", version: 1, facilityId: FACILITY };
const harness = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("nuqs", async () => (await import("../../../tests/helpers/linked-sheet-mocks")).nuqsModule);
vi.mock("@/hooks/use-entity-edit-record", async () => (await import("../../../tests/helpers/linked-sheet-mocks")).entityEditRecordModule);
vi.mock("@/hooks/use-linked-record-facility", () => ({ useLinkedRecordFacility: (record: unknown) => !!record }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: FACILITY }) }));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), setPageSize: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-storage-locations", () => ({
  useStorageLocations: () => ({ data: { items: [BIN], total: 1, totalPages: 1 }, isLoading: false, isPlaceholderData: false, error: null }),
  useArchiveStorageLocation: () => ({ mutateAsync: vi.fn() }),
  useRestoreStorageLocation: () => ({ mutateAsync: vi.fn() }),
  useDeleteStorageLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/toast", () => {
  const toast = { success: vi.fn(), error: (message: string) => harness.toastError(message) };
  return { useToast: () => toast };
});
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("./bin-reconcile-sheet", () => ({ BinReconcileSheet: () => null }));
vi.mock("./storage-bin-board", () => ({
  StorageBinBoard: ({ bins, onView }: { bins: Array<typeof BIN>; onView: (bin: typeof BIN) => void }) => (
    <div>{bins.map((bin) => <button key={bin.id} type="button" onClick={() => onView(bin)}>Open bin</button>)}</div>
  ),
}));
vi.mock("./storage-bin-sheet", () => ({
  StorageBinSheet: ({ state, onStateChange }: { state: { entity: typeof BIN | null } | null; onStateChange: (state: null) => void }) =>
    state ? <div role="dialog" aria-label={state.entity?.code}><button type="button" onClick={() => onStateChange(null)}>Close sheet</button></div> : null,
}));

import { StorageLocationList } from "./storage-location-list";

beforeEach(() => {
  linkedSheet.reset();
  harness.toastError.mockReset();
});
afterEach(cleanup);

describe("StorageLocationList record link", () => {
  it("opens the sheet from ?bin=", () => {
    linkedSheet.params.bin = BIN.id;
    linkedSheet.found(BIN);
    render(<StorageLocationList />);
    expect(screen.getByRole("dialog", { name: "BIN-001" })).toBeTruthy();
  });

  it("writes ?bin= when a bin opens and clears it on close", () => {
    const view = render(<StorageLocationList />);
    fireEvent.click(screen.getByRole("button", { name: "Open bin" }));
    expect(linkedSheet.params.bin).toBe(BIN.id);
    view.rerender(<StorageLocationList />);
    expect(screen.getByRole("dialog", { name: "BIN-001" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
    expect(linkedSheet.params.bin).toBeNull();
    view.rerender(<StorageLocationList />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("toasts and clears the param when the bin is missing", () => {
    linkedSheet.params.bin = "gone";
    linkedSheet.missing();
    render(<StorageLocationList />);
    expect(harness.toastError).toHaveBeenCalledWith("Linked storage bin could not be opened");
    expect(linkedSheet.params.bin).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
