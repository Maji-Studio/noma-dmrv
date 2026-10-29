// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkedSheet } from "../../../tests/helpers/linked-sheet-mocks";

const FACILITY = "facility-1";
const REACTOR = { id: "reactor-1", code: "RCT-001", identifier: "Kiln", version: 1, facilityId: FACILITY, reactorType: "fixed-bed" };
const harness = vi.hoisted(() => ({ toastError: vi.fn(), linkedReady: true }));

vi.mock("nuqs", async () => (await import("../../../tests/helpers/linked-sheet-mocks")).nuqsModule);
vi.mock("@/hooks/use-entity-edit-record", async () => (await import("../../../tests/helpers/linked-sheet-mocks")).entityEditRecordModule);
vi.mock("@/hooks/use-linked-record-facility", () => ({ useLinkedRecordFacility: (record: unknown) => ({ ready: !!record && harness.linkedReady, archivedFacility: null }) }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: FACILITY }) }));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/hooks/use-reactors", () => ({
  useReactorStats: () => ({ data: undefined, isLoading: false, isError: false }),
  useReactors: () => ({ data: { items: [REACTOR], total: 1, totalPages: 1 }, isLoading: false, error: null }),
  useCreateReactor: () => ({ startDraft: vi.fn(), isPending: false, mutateAsync: vi.fn() }),
  useUpdateReactor: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteReactor: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/components/ui/toast", () => {
  const toast = { success: vi.fn(), error: (message: string) => harness.toastError(message) };
  return { useToast: () => toast };
});
vi.mock("@/components/ui/data-table", () => ({
  DataTable: Object.assign(
    ({ data, onRowClick }: { data: unknown[]; onRowClick: (row: unknown) => void }) => (
      <div>{data.map((row, index) => <button key={index} type="button" onClick={() => onRowClick(row)}>Open row</button>)}</div>
    ),
    { Toolbar: () => null, Controls: () => null, Search: () => null, ColumnVisibility: () => null, Pagination: () => null },
  ),
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ open, title, onOpenChange }: { open: boolean; title: string; onOpenChange: (open: boolean) => void }) =>
    open ? <div role="dialog" aria-label={title}><button type="button" onClick={() => onOpenChange(false)}>Close sheet</button></div> : null,
}));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("./reactor-form", () => ({ ReactorForm: () => null }));
vi.mock("./reactor-read-sections", () => ({ reactorSheetSections: () => [] }));

import { ReactorList } from "./reactor-list";

beforeEach(() => {
  linkedSheet.reset();
  harness.toastError.mockReset();
  harness.linkedReady = true;
});
afterEach(cleanup);

describe("ReactorList record link", () => {
  it("opens the sheet from ?reactor=", () => {
    linkedSheet.params.reactor = REACTOR.id;
    linkedSheet.found(REACTOR);
    render(<ReactorList />);
    expect(screen.getByRole("dialog", { name: "RCT-001" })).toBeTruthy();
  });

  it("waits for the linked reactor's facility before opening", () => {
    linkedSheet.params.reactor = REACTOR.id;
    linkedSheet.found({ ...REACTOR, facilityId: "facility-2" });
    harness.linkedReady = false;
    render(<ReactorList />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("writes the param when a row opens and clears it on close", () => {
    const view = render(<ReactorList />);
    fireEvent.click(screen.getByRole("button", { name: "Open row" }));
    expect(linkedSheet.params.reactor).toBe(REACTOR.id);
    view.rerender(<ReactorList />);
    expect(screen.getByRole("dialog", { name: "RCT-001" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
    expect(linkedSheet.params.reactor).toBeNull();
    view.rerender(<ReactorList />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clears a linked sheet's param on close", () => {
    linkedSheet.params.reactor = REACTOR.id;
    linkedSheet.found(REACTOR);
    render(<ReactorList />);
    fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
    expect(linkedSheet.params.reactor).toBeNull();
  });

  it("toasts and clears the param when the reactor is missing", () => {
    linkedSheet.params.reactor = "gone";
    linkedSheet.missing();
    render(<ReactorList />);
    expect(harness.toastError).toHaveBeenCalledWith("Linked reactor could not be opened");
    expect(linkedSheet.params.reactor).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
