// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmissionLineList } from "./emission-line-list";
import { makeLine } from "./emission-line-test-fixtures";
import type { EmissionLine } from "./emission-line-display";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/emissions/cb" }));
vi.mock("@/hooks/use-emission-entries", () => ({ useConfirmEmissionEntry: () => ({ isPending: false, mutateAsync: vi.fn() }) }));
vi.mock("@/hooks/use-emission-line-comments", () => ({
  useSetEmissionLineComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteEmissionLineComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
const mocks = vi.hoisted(() => ({ remove: vi.fn(), replace: vi.fn() }));
vi.mock("@/hooks/use-emission-line-files", () => ({
  useEmissionLineFileUploadRequest: () => vi.fn(),
  useRemoveEmissionLineFile: () => ({ isPending: false, mutateAsync: mocks.remove }),
  useReplaceEmissionLineFiles: () => ({ isPending: false, mutateAsync: mocks.replace }),
}));

const SCOPE = { facilityId: "fac", creditBatchId: "cb" };
const NAME = "Metered electricity use emissions";
const RECORDS = { source: "productionRuns", count: 3, figure: { magnitude: "72", unit: "kWh" } } as const;
const DOCUMENT = { id: "doc-1", fileName: "meter-readings.pdf", version: 2 };

function lineWith(lineFile: Partial<NonNullable<EmissionLine["lineFile"]>>): EmissionLine {
  return makeLine({
    state: "filled", filePolicy: "lineFile", records: RECORDS,
    lineFile: { anchorId: null, version: null, documents: [], locked: false, canReplace: false, needsFile: false, policy: "lineFile", ...lineFile },
  });
}

function renderBody(line: EmissionLine, readOnly = false) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmissionLineList
        lines={[line]} grouped scope={SCOPE} expanded={new Set(["line-1"])} editingCommentId={null} undo={null} filterLabel={null}
        onClearFilter={vi.fn()}
        actions={{ readOnly, toggle: vi.fn(), form: vi.fn(), comment: vi.fn(), editingComment: vi.fn(), deleteEntry: vi.fn() }}
      />
    </QueryClientProvider>,
  );
  return within(screen.getByRole("table", { name: `Sources of ${NAME}` }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("component file on the From records row", () => {
  it("warns File missing and offers Add file when the amount needs a file and has none", () => {
    const table = renderBody(lineWith({ needsFile: true }));
    expect(table.getByText("File missing")).toBeTruthy();
    expect(table.getByRole("button", { name: `Add file on ${NAME}` })).toBeTruthy();
    fireEvent.click(table.getByRole("button", { name: `Add file on ${NAME}` }));
    expect(document.getElementById("line-file-line-1")).toBeTruthy();
  });

  it("lists the file names instead of the warning, and no Add file", () => {
    const table = renderBody(lineWith({ anchorId: "anchor", version: 1, documents: [DOCUMENT] }));
    expect(table.getByRole("link", { name: "meter-readings.pdf" }).getAttribute("href")).toBe("/api/documents/doc-1");
    expect(table.queryByText("File missing")).toBeNull();
    expect(table.queryByRole("button", { name: `Add file on ${NAME}` })).toBeNull();
  });

  it("removes a file from the row menu after a confirm", async () => {
    mocks.remove.mockResolvedValue({ id: "doc-1" });
    const table = renderBody(lineWith({ anchorId: "anchor", version: 1, documents: [DOCUMENT] }));
    fireEvent.click(table.getByRole("button", { name: `Actions for the records, ${NAME}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove meter-readings.pdf" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith({ documentId: "doc-1", expectedVersion: 2 }));
  });

  it("shows files and nothing to change while the set is locked", () => {
    const table = renderBody(lineWith({ anchorId: "anchor", version: 1, documents: [DOCUMENT], locked: true }));
    expect(table.getByRole("link", { name: "meter-readings.pdf" })).toBeTruthy();
    expect(table.queryByRole("button", { name: /^Actions for the records/ })).toBeNull();
  });

  it("offers no change to a locked set with no file, and no warning", () => {
    const table = renderBody(lineWith({ locked: true }));
    expect(table.queryByText("File missing")).toBeNull();
    expect(table.queryByRole("button", { name: `Add file on ${NAME}` })).toBeNull();
  });

  it("offers no change on a read-only page", () => {
    const table = renderBody(lineWith({ needsFile: true }), true);
    expect(table.getByText("File missing")).toBeTruthy();
    expect(table.queryByRole("button", { name: `Add file on ${NAME}` })).toBeNull();
    expect(table.queryByRole("button", { name: /^Actions for the records/ })).toBeNull();
  });

  it("replaces the set in the correction window after a confirm that says what stays", async () => {
    mocks.replace.mockResolvedValue({ id: "anchor" });
    const table = renderBody(lineWith({ anchorId: "anchor", version: 4, documents: [DOCUMENT], canReplace: true }));
    fireEvent.click(table.getByRole("button", { name: `Actions for the records, ${NAME}` }));
    expect(screen.queryByRole("menuitem", { name: /^Remove/ })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Replace files" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("The files already sent to Isometric stay in history and are no longer sent. You add the new files next.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace files" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith({ creditBatchId: "cb", componentId: "line-1", anchorId: "anchor", expectedVersion: 4 }));
  });

  it("keeps the slot off a records row another batch counts", () => {
    const table = renderBody(makeLine({
      state: "filled", filePolicy: "lineFile",
      records: { source: "transportLegs", count: 0, figure: { magnitude: "0", unit: "km * tonne" }, countedOn: [{ creditBatchId: "cb-1", code: "CB-26-001" }] },
      lineFile: { anchorId: null, version: null, documents: [], locked: false, canReplace: false, needsFile: true, policy: "lineFile" },
    }));
    expect(table.queryByText("File missing")).toBeNull();
  });
});
