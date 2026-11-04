// @vitest-environment jsdom
/** A link to a storage bin in an archived facility opens its sheet read only, even with no working facility (#1502). */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkedSheet } from "../../../tests/helpers/linked-sheet-mocks";

const BIN = { id: "bin-1", code: "BIN-001", name: "Bin one", version: 1, facilityId: "facility-x", archivedAt: null };
const harness = vi.hoisted(() => ({ context: { facilityId: null as string | null } }));

vi.mock("nuqs", async () => (await import("../../../tests/helpers/linked-sheet-mocks")).nuqsModule);
vi.mock("@/hooks/use-entity-edit-record", async () => (await import("../../../tests/helpers/linked-sheet-mocks")).entityEditRecordModule);
vi.mock("@/hooks/use-linked-record-facility", () => ({
  useLinkedRecordFacility: (record: unknown) => ({
    ready: !!record,
    readOnly: record ? { reason: "archived", facilityId: "facility-x", facilityName: "Mafinga", timezone: "UTC" } : null,
  }),
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => harness.context }));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), setPageSize: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-storage-locations", () => ({
  useStorageLocations: () => ({ data: { items: [], total: 0, totalPages: 0 }, isLoading: false, isPlaceholderData: false, error: null }),
  useArchiveStorageLocation: () => ({ mutateAsync: vi.fn() }),
  useRestoreStorageLocation: () => ({ mutateAsync: vi.fn() }),
  useDeleteStorageLocation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => <p>Select a facility</p> }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("./bin-reconcile-sheet", () => ({ BinReconcileSheet: () => null }));
vi.mock("./storage-bin-board", () => ({ StorageBinBoard: () => null }));
vi.mock("./storage-bin-sheet", () => ({
  StorageBinSheet: ({ state, readOnly }: { state: unknown; readOnly?: { message: string } }) =>
    state ? <div role="dialog">{readOnly?.message}</div> : null,
}));

import { StorageLocationList } from "./storage-location-list";

beforeEach(() => linkedSheet.reset());
afterEach(cleanup);

describe("StorageLocationList in an archived facility", () => {
  it("passes the read-only line to the sheet over the empty state", () => {
    harness.context.facilityId = null;
    linkedSheet.params.bin = BIN.id;
    linkedSheet.found(BIN);
    render(<StorageLocationList />);
    expect(screen.getByText("Select a facility")).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toBe("Mafinga is archived, so this storage bin is read-only.");
  });
});
