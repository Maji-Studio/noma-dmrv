// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmissionLineList } from "./emission-line-list";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/emissions/cb" }));

const SCOPE = { facilityId: "fac", creditBatchId: "cb" };

function renderList(lines = [makeLine()], canWrite = true) {
  const actions = { open: vi.fn() };
  render(<EmissionLineList lines={lines} grouped scope={SCOPE} actions={actions} canWrite={canWrite} filterLabel={null} onClearFilter={vi.fn()} />);
  return actions;
}

afterEach(cleanup);

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
    render(<EmissionLineList lines={[]} grouped scope={SCOPE} actions={{ open: vi.fn() }} canWrite filterLabel="Needs review" onClearFilter={onClear} />);
    expect(screen.getByText('No lines in "Needs review"')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all lines" }));
    expect(onClear).toHaveBeenCalled();
  });
});
