// @vitest-environment jsdom
/**
 * A refused Reactor delete shows the server's reason inside the open
 * confirmation dialog, not on the page behind the modal.
 */
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const REACTOR = { id: "6f1c4d3a-0f2b-4d6a-9f1e-0a1b2c3d4e5f", code: "RCT-001", identifier: "Kiln", version: 4, facilityId: "facility-1", reactorType: "fixed-bed" };
// ServerError splits a message at its first sentence, so match on that.
const REFUSAL = /Cannot delete reactor with associated production runs/;
const SERVER_MESSAGE = "Cannot delete reactor with associated production runs. Remove the production runs first.";

const harness = vi.hoisted(() => ({ remove: vi.fn() }));

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "facility-1" }) }));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/hooks/use-reactors", () => ({
  useReactorStats: () => ({ data: undefined, isLoading: false, isError: false }),
  useReactors: () => ({ data: { items: [REACTOR], total: 1, totalPages: 1 }, isLoading: false, error: null }),
  useCreateReactor: () => ({ startDraft: vi.fn(), isPending: false, mutateAsync: vi.fn() }),
  useUpdateReactor: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteReactor: () => ({ isPending: false, mutateAsync: harness.remove }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  RowActionsMenu: ({ actions }: { actions: Array<{ label: string; onSelect: () => void }> }) => (
    <div>{actions.map((action) => <button key={action.label} type="button" onClick={action.onSelect}>{`Row ${action.label}`}</button>)}</div>
  ),
}));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: Object.assign(
    ({ columns, data }: {
      columns: Array<{ id?: string; cell?: (context: { row: { original: unknown } }) => ReactNode }>;
      data: unknown[];
    }) => <div>{data.map((row, index) => <div key={index}>{columns.find((column) => column.id === "actions")?.cell?.({ row: { original: row } })}</div>)}</div>,
    { Toolbar: () => null, Controls: () => null, Search: () => null, ColumnVisibility: () => null, Pagination: () => null },
  ),
}));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("./reactor-form", () => ({ ReactorForm: () => null }));

import { ReactorList } from "./reactor-list";

afterEach(cleanup);

describe("Reactor delete refusal", () => {
  it("renders the refusal inside the open dialog and nowhere else, and clears it on cancel", async () => {
    harness.remove.mockRejectedValue(new Error(SERVER_MESSAGE));
    render(<ReactorList />);

    fireEvent.click(screen.getByRole("button", { name: "Row Delete" }));
    expect(within(screen.getByRole("dialog")).queryByText(REFUSAL)).toBeNull();
    expect(within(screen.getByRole("dialog")).getByText(/Note: Reactors/)).toBeTruthy();

    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" })); });

    expect(harness.remove).toHaveBeenCalledWith({ reactorId: REACTOR.id, expectedVersion: 4 });
    expect(within(screen.getByRole("dialog")).getByText(REFUSAL)).toBeTruthy();
    expect(screen.getAllByText(REFUSAL)).toHaveLength(1);
    // The rule is stated once: the grey Note gives way to the refusal.
    expect(within(screen.getByRole("dialog")).queryByText(/Note: Reactors/)).toBeNull();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Row Delete" }));
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });
});

describe("Reactor stale delete refusal", () => {
  it("closes the dialog on a stale version and does not carry the notice into the next dialog", async () => {
    const { StaleVersionError, STALE_VERSION_MESSAGE, STALE_VERSION_CONFLICT_CODE } = await import("@/lib/stale-version");
    harness.remove.mockRejectedValue(new StaleVersionError(STALE_VERSION_MESSAGE, { entity: "reactor", id: REACTOR.id, code: STALE_VERSION_CONFLICT_CODE }));
    render(<ReactorList />);

    fireEvent.click(screen.getByRole("button", { name: "Row Delete" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/RCT-001/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Row Delete" }));
    expect(screen.queryByText(/RCT-001/)).toBeNull();
  });
});
