// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmissionLine } from "./emission-line-display";
import type { LineActions, RowUndo } from "./emission-line-list";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";

const mocks = vi.hoisted(() => ({
  lines: [] as unknown[],
  filter: null as string | null,
  deleteEntry: vi.fn(),
  restoreEntry: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "fac" }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "" }),
}));
vi.mock("@/hooks/use-emissions-overview", () => ({
  useEmissionsOverview: () => ({
    data: { batches: [{ creditBatchId: "cb", code: "CB-1", startDate: "2026-09-01", endDate: null, templateName: null }] },
    isSuccess: true,
    error: null,
  }),
}));
vi.mock("@/hooks/use-emission-entries", () => ({
  useBatchEmissionLines: () => ({ data: mocks.lines, isLoading: false, error: null, refetch: vi.fn() }),
  useDeleteEmissionEntry: () => ({ isPending: false, mutateAsync: mocks.deleteEntry }),
  useRestoreEmissionEntry: () => ({ isPending: false, mutateAsync: mocks.restoreEntry }),
}));
vi.mock("./batch-emissions-query", () => ({
  useBatchLineQuery: () => ({ filter: mocks.filter, sort: "template", setFilter: vi.fn(), setSort: vi.fn() }),
}));
vi.mock("./emissions-overview-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./emissions-overview-query")>()),
  useEmissionsOverviewQuery: () => ({ query: {} }),
}));
vi.mock("./batch-emissions-pager", () => ({ BatchEmissionsTopBar: () => null }));
vi.mock("./batch-emissions-toolbar", () => ({ BatchKpiStrip: () => null, LineToolbar: () => null, lineChipLabel: () => null }));
vi.mock("./emission-entry-form-panel", () => ({ EmissionEntryFormPanel: () => null }));
// The list itself is covered by emission-line-list.test.tsx; here each row offers a Delete and shows its Undo bar.
vi.mock("./emission-line-list", () => ({
  EmissionLineList: ({ lines, actions, undo }: { lines: EmissionLine[]; actions: LineActions; undo: RowUndo | null }) => (
    <ul aria-label="Emission lines">
      {lines.map((line) => (
        <li key={line.componentId} aria-label={line.displayName}>
          <button type="button" onClick={() => actions.deleteEntry(line, line.entries[0])}>Delete</button>
          {undo?.componentId === line.componentId && undo.bar}
        </li>
      ))}
    </ul>
  ),
}));

import { BatchEmissionsPage } from "./batch-emissions-page";

const COUNTING = makeLine({ state: "filled", entries: [makeEntry({ version: 4 })] });

beforeEach(() => {
  mocks.lines = [COUNTING];
  mocks.filter = null;
  mocks.deleteEntry.mockResolvedValue({ id: "entry-1", version: 5 });
  mocks.restoreEntry.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BatchEmissionsPage undo", () => {
  it("shows Undo under the row and restores with the version the delete returned", async () => {
    mocks.deleteEntry.mockResolvedValue({ id: "entry-1", version: 9 });
    render(<BatchEmissionsPage creditBatchId="cb" entriesEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.deleteEntry).toHaveBeenCalledWith({ id: "entry-1", expectedVersion: 4 }));
    const row = screen.getByRole("listitem", { name: COUNTING.displayName });
    fireEvent.click(await within(row).findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(mocks.restoreEntry).toHaveBeenCalledWith({ id: "entry-1", expectedVersion: 9 }));
  });

  it("keeps Undo on screen when the delete moves the line out of the filter", async () => {
    mocks.filter = "done";
    mocks.deleteEntry.mockImplementation(async () => {
      mocks.lines = [{ ...COUNTING, state: "empty", entries: [] }];
      return { id: "entry-1", version: 5 };
    });
    render(<BatchEmissionsPage creditBatchId="cb" entriesEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("listitem", { name: COUNTING.displayName })).toBeNull();
    await waitFor(() => expect(mocks.restoreEntry).toHaveBeenCalledWith({ id: "entry-1", expectedVersion: 5 }));
  });

  it("confirms before deleting a stopped entry and offers no Undo", async () => {
    mocks.lines = [makeLine({ state: "needsReview", entries: [makeEntry({ counts: false, canConfirm: false, version: 2 })] })];
    render(<BatchEmissionsPage creditBatchId="cb" entriesEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mocks.deleteEntry).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/cannot be undone/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.deleteEntry).toHaveBeenCalledWith({ id: "entry-1", expectedVersion: 2 }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});
