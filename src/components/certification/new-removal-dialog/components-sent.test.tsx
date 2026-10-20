// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: ({ label }: { label?: string }) => <button type="button" aria-label={label} /> }));
vi.mock("@/hooks/use-documents", () => ({ useDocumentsForEntity: () => ({ data: [] }) }));

import { ComponentsSent } from "./components-sent";
import { sentComponentRows, SENT_SOURCE } from "./components-sent-model";

const BATCH_ID = "batch-1";

function entry(overrides: Record<string, unknown>) {
  return { id: "e1", kind: "value", counts: true, documentCount: 0, hasEvidence: false, total: null, componentId: "x", ...overrides };
}
function line(overrides: Record<string, unknown>) {
  return {
    componentId: "x", displayName: "Component", groupKey: "g", groupName: "Group",
    state: "empty", records: null, automaticFigure: null, entries: [], total: null, ...overrides,
  };
}

const LINES = [
  line({
    componentId: "auto", displayName: "Metered electricity", state: "filled",
    records: { source: "productionRuns", count: 3, figure: { magnitude: "72", unit: "kWh" } },
    automaticFigure: { magnitude: "72", unit: "kWh" }, total: { magnitude: "72", unit: "kWh" },
  }),
  line({
    componentId: "manual", displayName: "Staff travel", state: "filled",
    entries: [entry({ id: "e1", documentCount: 2 }), entry({ id: "e2", documentCount: 1 })],
    total: { magnitude: "30", unit: "L" },
  }),
  line({ componentId: "zero", displayName: "Pyrolyzer CO", state: "confirmedZero", entries: [entry({ id: "z1", kind: "zero" })] }),
];

afterEach(cleanup);

describe("sentComponentRows", () => {
  it("names the three sources: automatic datapoints, manual entries and a recorded zero", () => {
    const rows = sentComponentRows(LINES as never);
    expect(rows.map((row) => row.source)).toEqual([
      SENT_SOURCE.automatic, "2 manual entries", SENT_SOURCE.zero,
    ]);
    expect(rows.map((row) => row.value)).toEqual(["72 kWh", "30 L", "0"]);
  });

  it("counts the files of the entries sent, and none for a zero or automatic datapoints", () => {
    const rows = sentComponentRows(LINES as never);
    expect(rows.map((row) => row.fileCount)).toEqual([0, 3, 0]);
    expect(rows[1].fileEntryIds).toEqual(["e1", "e2"]);
  });
});

describe("ComponentsSent", () => {
  const ctx = {
    memberBatches: [{ id: BATCH_ID, code: "CB-26-001", startDate: "2026-09-01", endDate: "2026-09-30" }],
    emissionLinesByBatchId: { [BATCH_ID]: LINES },
  } as unknown as Pick<RemovalCertifyContext, "memberBatches" | "emissionLinesByBatchId">;

  it("lists every component with its value, source and files", () => {
    render(<ComponentsSent ctx={ctx} facilityId="facility-1" />);
    const list = screen.getByRole("list", { name: "Components sent for CB-26-001" });

    const travel = within(list).getByText("Staff travel").closest("li")!;
    expect(within(travel).getAllByText("2 manual entries").length).toBeGreaterThan(0);
    expect(within(travel).getAllByText("3 files").length).toBeGreaterThan(0);
    expect(within(travel).getByText("30 L")).toBeTruthy();

    const zero = within(list).getByText("Pyrolyzer CO").closest("li")!;
    expect(within(zero).getByText("Recorded zero")).toBeTruthy();
    expect(within(zero).getByText("0")).toBeTruthy();

    const auto = within(list).getByText("Metered electricity").closest("li")!;
    expect(within(auto).getByText("Automatic datapoints")).toBeTruthy();
  });

  it("offers the file names behind a toggletip, reachable on a tap", () => {
    render(<ComponentsSent ctx={ctx} facilityId="facility-1" />);
    expect(screen.getAllByRole("button", { name: "File names for Staff travel" }).length).toBeGreaterThan(0);
  });

  it("renders nothing without lines", () => {
    const { container } = render(
      <ComponentsSent ctx={{ memberBatches: [], emissionLinesByBatchId: {} } as never} facilityId="facility-1" />,
    );
    expect(container.textContent).toBe("");
  });
});
