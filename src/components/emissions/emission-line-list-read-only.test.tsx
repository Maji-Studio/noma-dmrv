// @vitest-environment jsdom
/** A read-only credit batch page shows entries and comments but offers no write (#1502). */
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmissionLineList } from "./emission-line-list";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/credit-batches/cb" }));
vi.mock("@/hooks/use-emission-line-comments", () => ({
  useSetEmissionLineComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useDeleteEmissionLineComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-emission-entries", () => ({ useConfirmEmissionEntry: () => ({ isPending: false, mutateAsync: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

const SCOPE = { facilityId: "fac", creditBatchId: "cb" };
const COMMENT = { id: "c1", body: "No flights this period", version: 3, updatedAt: new Date(), updatedBy: "u1" };
const LINES = [
  makeLine({ state: "filled", entries: [makeEntry({ documentCount: 0 }), makeEntry({ id: "entry-2", counts: false, canConfirm: true })], comment: COMMENT }),
  makeLine({ componentId: "line-2", displayName: "Empty line", state: "empty", entries: [] }),
];

function renderList(readOnly: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmissionLineList
        lines={LINES}
        grouped
        scope={SCOPE}
        actions={{ readOnly, toggle: vi.fn(), form: vi.fn(), comment: vi.fn(), editingComment: vi.fn(), deleteEntry: vi.fn() }}
        expanded={new Set(["line-1"])}
        editingCommentId={null}
        undo={null}
        filterLabel={null}
        onClearFilter={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const WRITE = /^(Add manual entry|Add comment|Add file|Enter again|Confirm|Actions for (the|Metered|Empty).*)/;

afterEach(cleanup);

describe("emission lines on a read-only batch", () => {
  it("keeps entries and comments readable and offers no write control", () => {
    renderList(true);
    expect(screen.getByText("No flights this period")).toBeTruthy();
    expect(screen.getAllByText("42.5 kWh").length).toBeGreaterThan(0);
    const writes = screen.queryAllByRole("button").filter((button) => WRITE.test(button.textContent?.trim() || button.getAttribute("aria-label") || ""));
    expect(writes.map((button) => button.textContent || button.getAttribute("aria-label"))).toEqual([]);
    expect(screen.queryByText("Add manual entry")).toBeNull();
    expect(screen.queryByRole("button", { name: /Actions for the (stopped )?manual entry/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for the comment" })).toBeNull();
  });

  it("offers the writes when the batch is editable", () => {
    renderList(false);
    expect(screen.getByRole("button", { name: "Actions for the comment" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Actions for the manual entry/ }).length).toBeGreaterThan(0);
  });

  it("keeps a setup notice's text but drops its Settings link", () => {
    const setup = makeLine({ componentId: "line-3", displayName: "Needs setup line", state: "needsSetup", entries: [] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EmissionLineList
          lines={[setup]}
          grouped
          scope={SCOPE}
          actions={{ readOnly: true, toggle: vi.fn(), form: vi.fn(), comment: vi.fn(), editingComment: vi.fn(), deleteEntry: vi.fn() }}
          expanded={new Set(["line-3"])}
          editingCommentId={null}
          undo={null}
          filterLabel={null}
          onClearFilter={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryAllByRole("link", { name: /Removal templates|Answer in Settings|Decide/i })).toEqual([]);
    expect(screen.getByRole("region", { name: "Needs setup line details" }).textContent).not.toBe("");
  });

  it.each([[true, false], [false, true]])("late entry waiting for a Removal: readOnly=%s hides the repair link (shown=%s)", (readOnly, linked) => {
    const late = makeLine({ state: "filled", entries: [makeEntry({ carry: { receiver: null, waitingReason: "noDraft" } })] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EmissionLineList
          lines={[late]}
          grouped
          scope={SCOPE}
          actions={{ readOnly, toggle: vi.fn(), form: vi.fn(), comment: vi.fn(), editingComment: vi.fn(), deleteEntry: vi.fn() }}
          expanded={new Set(["line-1"])}
          editingCommentId={null}
          undo={null}
          filterLabel={null}
          onClearFilter={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Waiting for a Removal\./)).toBeTruthy();
    expect(!!screen.queryByRole("link", { name: "New Removal" })).toBe(linked);
    cleanup();
  });
});
