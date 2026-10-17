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

  it("shows the body of an expanded row with From records, Manual entries and Total", () => {
    renderList([makeLine({ state: "filled", total: { magnitude: "42.5", unit: "kWh" }, entries: [makeEntry()] })], true, ["line-1"]);
    expect(screen.getByRole("button", { name: "Metered electricity use emissions" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: /details/ })).toBeTruthy();
    expect(screen.getByText("From records")).toBeTruthy();
    expect(screen.getByText("Manual entries")).toBeTruthy();
    expect(screen.getAllByText("Total").length).toBeGreaterThan(0);
  });

  it("offers Add manual entry on the right of each row, several times over", () => {
    const actions = renderList([makeLine({ state: "filled", entries: [makeEntry()] })]);
    fireEvent.click(screen.getByRole("button", { name: "Add manual entry on Metered electricity use emissions" }));
    expect(actions.form).toHaveBeenCalledWith(expect.anything(), { kind: "add" });
    expect(actions.toggle).not.toHaveBeenCalled();
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

  it("marks a line with a comment and shows it in the body with Edit comment and Delete", () => {
    renderList([makeLine({ comment: COMMENT })], true, ["line-1"]);
    expect(screen.getByText(", has a comment")).toBeTruthy();
    expect(screen.getByText("No flights this period")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit comment" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.deleteComment).toHaveBeenCalledWith({ facilityId: "fac", id: "c1", expectedVersion: 3 }));
  });
});
