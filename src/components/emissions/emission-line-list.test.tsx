// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmissionLineList } from "./emission-line-list";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/emissions/cb" }));

const SCOPE = { facilityId: "fac", creditBatchId: "cb" };

vi.mock("@/hooks/use-emission-line-comments", () => ({
  useSetEmissionLineComment: () => ({ isPending: false, mutateAsync: mocks.setComment }),
  useDeleteEmissionLineComment: () => ({ isPending: false, mutateAsync: mocks.deleteComment }),
}));
vi.mock("@/hooks/use-emission-entries", () => ({ useConfirmEmissionEntry: () => ({ isPending: false, mutateAsync: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

const mocks = vi.hoisted(() => ({ setComment: vi.fn(), deleteComment: vi.fn() }));

const SECOND_ENTRY = makeEntry({
  id: "entry-2",
  occurredOn: "2026-09-15",
  values: [{ id: "v2", organizationId: "org", entryId: "entry-2", inputKey: "energy", magnitude: "38", unit: "kWh", massDistanceDetail: null }],
  total: { magnitude: "38", unit: "kWh" },
});

const COMMENT = { id: "c1", body: "No flights this period", version: 3, updatedAt: new Date(), updatedBy: "u1" };

function makeActions() {
  return { toggle: vi.fn(), form: vi.fn(), comment: vi.fn(), editingComment: vi.fn(), deleteEntry: vi.fn() };
}

function renderList(lines = [makeLine()], canWrite = true, expanded: string[] = [], editingCommentId: string | null = null) {
  const actions = makeActions();
  render(
    <QueryClientProvider client={new QueryClient()}>
    <EmissionLineList
      lines={lines}
      grouped
      scope={SCOPE}
      actions={actions}
      expanded={new Set(expanded)}
      editingCommentId={editingCommentId}
      undo={null}
      canWrite={canWrite}
      filterLabel={null}
      onClearFilter={vi.fn()}
    />
    </QueryClientProvider>,
  );
  return actions;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EmissionLineList", () => {
  it("shows records and manual entries as chips, with the records chip linking upstream", () => {
    renderList([
      makeLine({
        state: "filled",
        records: { source: "productionRuns", count: 3, figure: { magnitude: "72", unit: "kWh" } },
        entries: [makeEntry({ hasEvidence: false, documentCount: 0 })],
      }),
    ]);
    const link = screen.getByRole("link", { name: /72 kWh from 3 production runs/ });
    expect(link.getAttribute("href")).toBe("/production-runs?facility=fac&creditBatch=cb");
    expect(screen.getByRole("button", { name: "1 manual entry, file missing. Show manual entries" })).toBeTruthy();
  });

  it("points Needs setup lines at the template review", () => {
    renderList([makeLine({ state: "needsSetup" })]);
    expect(screen.getByRole("link", { name: "An admin sets this line up in the template review" })).toBeTruthy();
  });

  it("says which chip hides every line", () => {
    const onClear = vi.fn();
    render(<EmissionLineList lines={[]} grouped scope={SCOPE} actions={makeActions()} expanded={new Set()} editingCommentId={null} undo={null} canWrite filterLabel="Needs review" onClearFilter={onClear} />);
    expect(screen.getByText('No lines in "Needs review"')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all lines" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("expands as an accordion from the name button and the row header", () => {
    const line = makeLine();
    const actions = renderList([line]);
    const toggle = screen.getByRole("button", { name: "Metered electricity use emissions" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("line-body-line-1");
    fireEvent.click(toggle);
    expect(actions.toggle).toHaveBeenCalledWith(line);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("shows the body of an expanded row as a sources table with the Total", () => {
    renderList([makeLine({
      state: "filled",
      records: { source: "productionRuns", count: 3, figure: { magnitude: "72", unit: "kWh" } },
      entries: [makeEntry(), SECOND_ENTRY],
      total: { magnitude: "152.5", unit: "kWh" },
    })], true, ["line-1"]);
    expect(screen.getByRole("button", { name: "Metered electricity use emissions" }).getAttribute("aria-expanded")).toBe("true");
    const table = within(screen.getByRole("region", { name: /details/ })).getByRole("table", { name: "Sources of Metered electricity use emissions" });
    expect(within(table).getByRole("link", { name: "3 production runs. Open production runs" })).toBeTruthy();
    // The group is named once; its rows are told apart by date.
    expect(within(table).getAllByText("Manual entries")).toHaveLength(1);
    expect(within(table).getByRole("rowheader", { name: "Total" })).toBeTruthy();
    expect(within(table).getByText("152.5 kWh")).toBeTruthy();
  });

  it("drops the Total when one part makes the line", () => {
    renderList([makeLine({ state: "filled", total: { magnitude: "42.5", unit: "kWh" }, entries: [makeEntry()] })], true, ["line-1"]);
    expect(screen.getByText("Manual entry")).toBeTruthy();
    expect(screen.queryByRole("rowheader", { name: "Total" })).toBeNull();
  });

  it("folds a line with nothing yet into one sentence and offers Add manual entry once", () => {
    renderList([makeLine()], true, ["line-1"]);
    const body = screen.getByRole("region", { name: /details/ });
    expect(within(body).getByText("No records source and no manual entries yet.")).toBeTruthy();
    expect(within(body).queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Add manual entry/ })).toHaveLength(1);
    expect(within(body).getByRole("button", { name: "Add comment" })).toBeTruthy();
  });

  it("puts the line description behind an info button beside the name that does not toggle the row", () => {
    const actions = renderList([makeLine({ description: "Electricity drawn from the grid for the plant." })]);
    const info = screen.getByRole("button", { name: "More about Metered electricity use emissions" });
    expect(info.getAttribute("aria-description")).toBe("Electricity drawn from the grid for the plant.");
    fireEvent.click(info);
    expect(actions.toggle).not.toHaveBeenCalled();
  });

  it("has no info button when the line has no description", () => {
    renderList([makeLine()]);
    expect(screen.queryByRole("button", { name: /More about/ })).toBeNull();
  });

  it("puts Add manual entry and Add comment under the table as one group", () => {
    renderList([makeLine({
      state: "filled",
      records: { source: "productionRuns", count: 3, figure: { magnitude: "72", unit: "kWh" } },
      entries: [makeEntry()],
      total: { magnitude: "114.5", unit: "kWh" },
    })], true, ["line-1"]);
    const table = screen.getByRole("table");
    expect(within(table).queryByRole("button", { name: /Add manual entry/ })).toBeNull();
    const body = screen.getByRole("region", { name: /details/ });
    expect(within(body).getByRole("button", { name: "Add manual entry on Metered electricity use emissions" })).toBeTruthy();
    expect(within(body).getByRole("button", { name: "Add comment" })).toBeTruthy();
  });

  it("offers no Add on a one-entry line that holds its entry", () => {
    renderList([makeLine({ state: "filled", entryPolicy: "single", contract: { scope: "operating", entryPolicy: "single" } as never, entries: [makeEntry()] })], true, ["line-1"]);
    expect(screen.queryByRole("button", { name: /Add manual entry/ })).toBeNull();
  });

  it("offers Add manual entry in the row menu, several times over", async () => {
    const actions = renderList([makeLine({ state: "filled", entries: [makeEntry()] })]);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Metered electricity use emissions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add manual entry" }));
    expect(actions.form).toHaveBeenCalledWith(expect.anything(), { kind: "add" });
    expect(actions.toggle).not.toHaveBeenCalled();
  });

  it("shows Add manual entry as a quiet link in an empty Sources cell", () => {
    const actions = renderList([makeLine()]);
    expect(screen.queryByText("No records source")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add manual entry on Metered electricity use emissions" }));
    expect(actions.form).toHaveBeenCalledWith(expect.anything(), { kind: "add" });
    expect(actions.toggle).not.toHaveBeenCalled();
  });

  it("keeps the quiet Sources text when the line cannot take an entry", () => {
    renderList([makeLine()], false);
    expect(screen.getByText("No records source")).toBeTruthy();
  });

  it("hides Add manual entry when manual entries are off or the line takes none", () => {
    cleanup();
    renderList([makeLine()], false);
    expect(screen.queryByRole("button", { name: /Add manual entry/ })).toBeNull();
    cleanup();
    renderList([makeLine({ entryPolicy: "none" })]);
    expect(screen.queryByRole("button", { name: /Add manual entry/ })).toBeNull();
  });

  it("has no Nothing to record action", () => {
    renderList([makeLine()], true, ["line-1"]);
    expect(screen.queryByText(/nothing to record/i)).toBeNull();
  });

  it("marks a line with a comment and shows it in the body with its own Edit comment and Delete comment", async () => {
    const actions = renderList([makeLine({ comment: COMMENT })], true, ["line-1"]);
    expect(screen.getByText("Has a comment")).toBeTruthy();
    expect(screen.getByText("No flights this period")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add comment" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Actions for the comment" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit comment" }));
    expect(actions.editingComment).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("opens the comment editor from Add comment", () => {
    const actions = renderList([makeLine()], true, ["line-1"]);
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    expect(actions.editingComment).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("creates a comment without an id or version", async () => {
    mocks.setComment.mockResolvedValue({});
    const actions = renderList([makeLine()], true, ["line-1"], "line-1");
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), { target: { value: "  Checked with finance  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() =>
      expect(mocks.setComment).toHaveBeenCalledWith({ facilityId: "fac", creditBatchId: "cb", componentId: "line-1", body: "Checked with finance" }),
    );
    await waitFor(() => expect(actions.editingComment).toHaveBeenCalledWith(expect.anything(), false));
  });

  it("edits a comment with its id and version and shows a conflict", async () => {
    mocks.setComment.mockRejectedValue(new Error("boom"));
    renderList([makeLine({ comment: COMMENT })], true, ["line-1"], "line-1");
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() =>
      expect(mocks.setComment).toHaveBeenCalledWith({ facilityId: "fac", creditBatchId: "cb", componentId: "line-1", body: "Updated", id: "c1", expectedVersion: 3 }),
    );
    expect(await screen.findByText("boom")).toBeTruthy();
  });

  it("deletes a comment after confirming", async () => {
    mocks.deleteComment.mockResolvedValue({ id: "c1" });
    renderList([makeLine({ comment: COMMENT })], true, ["line-1"]);
    fireEvent.click(screen.getByRole("button", { name: "Actions for the comment" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete comment" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.deleteComment).toHaveBeenCalledWith({ facilityId: "fac", id: "c1", expectedVersion: 3 }));
  });
});
