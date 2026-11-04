// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmissionLine } from "./emission-line-display";
import type { LineActions, RowUndo } from "./emission-line-list";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";
import { EmissionLinesBlockedError } from "@/lib/certification/emission-lines-blocked-error";
import { removalTemplateBlocker } from "@/lib/certification/removal-template-blockers";

const mocks = vi.hoisted(() => ({
  lines: [] as unknown[],
  linesError: null as Error | null,
  filter: null as string | null,
  fromList: false,
  deleteEntry: vi.fn(),
  restoreEntry: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/components/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: () => ({ timeZone: "UTC", hint: "" }),
}));
vi.mock("@/hooks/use-emission-entries", () => ({
  useBatchEmissionLines: () => ({ data: mocks.linesError ? undefined : mocks.lines, isLoading: false, error: mocks.linesError, refetch: vi.fn() }),
  useDeleteEmissionEntry: () => ({ isPending: false, mutateAsync: mocks.deleteEntry }),
  useRestoreEmissionEntry: () => ({ isPending: false, mutateAsync: mocks.restoreEntry }),
}));
vi.mock("./batch-emissions-query", () => ({
  useBatchLineQuery: () => ({ filter: mocks.filter, sort: "template", setFilter: vi.fn(), setSort: vi.fn() }),
  useOpenedFromEmissionsList: () => mocks.fromList,
}));
vi.mock("./batch-emissions-pager", () => ({ BatchEmissionsPager: () => <nav aria-label="Credit batches" /> }));
vi.mock("./batch-emissions-toolbar", () => ({ BatchKpiStrip: () => null, LineToolbar: () => null, lineChipLabel: () => null }));
vi.mock("./emission-entry-form-panel", () => ({ EmissionEntryFormPanel: () => null }));
// The list itself is covered by emission-line-list.test.tsx; here each row offers a Delete and shows its Undo bar.
vi.mock("./emission-line-list", () => ({
  EmissionLineList: ({ lines, actions, undo }: { lines: EmissionLine[]; actions: LineActions; undo: RowUndo | null }) => (
    <ul aria-label="Components">
      {lines.map((line) => (
        <li key={line.componentId} aria-label={line.displayName}>
          <button type="button" onClick={() => actions.deleteEntry(line, line.entries[0])}>Delete</button>
          {undo?.componentId === line.componentId && undo.bar}
        </li>
      ))}
    </ul>
  ),
}));

import { BatchEmissions } from "./batch-emissions";

const BATCH = { creditBatchId: "cb", code: "CB-1", startDate: "2026-09-01", endDate: null };
const renderBatch = () => render(<BatchEmissions facilityId="fac" batch={BATCH} />);

const COUNTING = makeLine({ state: "filled", entries: [makeEntry({ version: 4 })] });

beforeEach(() => {
  mocks.lines = [COUNTING];
  mocks.linesError = null;
  mocks.filter = null;
  mocks.fromList = false;
  mocks.deleteEntry.mockResolvedValue({ id: "entry-1", version: 5 });
  mocks.restoreEntry.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BatchEmissions undo", () => {
  it("shows Undo under the row and restores with the version the delete returned", async () => {
    mocks.deleteEntry.mockResolvedValue({ id: "entry-1", version: 9 });
    renderBatch();
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
    renderBatch();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("listitem", { name: COUNTING.displayName })).toBeNull();
    await waitFor(() => expect(mocks.restoreEntry).toHaveBeenCalledWith({ id: "entry-1", expectedVersion: 5 }));
  });
  it("confirms before deleting a stopped entry and offers no Undo", async () => {
    mocks.lines = [makeLine({ state: "needsReview", entries: [makeEntry({ counts: false, canConfirm: false, version: 2 })] })];
    renderBatch();
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

describe("BatchEmissions template blocker", () => {
  it("explains a missing template with a link and no Try again", () => {
    mocks.lines = [];
    mocks.linesError = new EmissionLinesBlockedError(removalTemplateBlocker("unpinnedTemplate"));
    renderBatch();
    expect(screen.getByText("Set a Removal template in Settings, Removal templates.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set template" }).getAttribute("href")).toBe("/settings/removal-templates?facility=fac&setup=template");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
  it("keeps Try again for a real load failure", () => {
    mocks.lines = [];
    mocks.linesError = new Error("Network down");
    renderBatch();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("BatchEmissions pager", () => {
  it("offers previous and next only when the tab was opened from the Emissions list", () => {
    renderBatch();
    expect(screen.queryByRole("navigation", { name: "Credit batches" })).toBeNull();
    cleanup();
    mocks.fromList = true;
    renderBatch();
    expect(screen.getByRole("navigation", { name: "Credit batches" })).toBeTruthy();
  });
});
