// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label, children }: { label?: string; children?: React.ReactNode }) => (
    <button type="button" aria-label={label} data-reason={typeof children === "string" ? children : undefined} />
  ),
}));
vi.mock("@/hooks/use-documents", () => ({ useDocumentsForEntity: () => ({ data: [] }) }));

import { ComponentsSent } from "./components-sent";
import { CARBON_LEDGER_POINTER, sentComponentRows, SENT_SOURCE } from "./components-sent-model";

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
function binding(componentId: string, wireMagnitude: number, wireUnit: string, kind = "monitored") {
  return { componentId, componentBlueprintKey: "b", inputKey: "i", binding: kind, wireMagnitude, wireUnit };
}
function review(bindings: unknown[], omittedComponentIds: string[] = []) {
  return { bindings, omittedComponentIds } as never;
}

const LINES = [
  line({
    componentId: "auto", displayName: "Metered electricity", state: "filled",
    records: { source: "productionRuns", count: 3, figure: { magnitude: "72", unit: "kWh" } },
    automaticFigure: { magnitude: "72", unit: "kWh" },
  }),
  line({
    componentId: "manual", displayName: "Staff travel", state: "filled",
    entries: [entry({ id: "e1", documentCount: 2 }), entry({ id: "e2", documentCount: 1 })],
  }),
  line({ componentId: "zero", displayName: "Pyrolyzer CO", state: "confirmedZero", entries: [entry({ id: "z1", kind: "zero" })] }),
];
const REVIEW = review([
  binding("auto", 72, "kWh"), binding("manual", 30, "L"), binding("zero", 0, "kWh"),
]);

afterEach(cleanup);

describe("sentComponentRows", () => {
  it("names the three sources: automatic datapoints, manual entries and a recorded zero", () => {
    const rows = sentComponentRows([LINES] as never, { review: REVIEW });
    expect(rows.map((row) => row.source)).toEqual([SENT_SOURCE.automatic, "2 manual entries", SENT_SOURCE.zero]);
  });

  it("shows the figures the compiled review sends, a zero with its unit", () => {
    const rows = sentComponentRows([LINES] as never, { review: REVIEW });
    expect(rows.map((row) => row.value)).toEqual(["72 kWh", "30 L", "0 kWh"]);
  });

  it("shows only what this Removal sends when a batch has more automatic records than the Removal includes", () => {
    // The batch-wide figure counts two shipments (100); the Removal includes one (40).
    const lines = [line({
      componentId: "ship", displayName: "Biochar transport", state: "filled",
      records: { source: "deliveries", count: 2, figure: { magnitude: "100", unit: "tonne * km" } },
      automaticFigure: { magnitude: "100", unit: "tonne * km" }, total: { magnitude: "100", unit: "tonne * km" },
    })];
    const [row] = sentComponentRows([lines] as never, { review: review([binding("ship", 40, "t·km")]) });
    expect(row.value).toBe("40 t·km");
    expect(row.value).not.toContain("100");
  });

  it("counts the files of the entries sent, and none for a zero or automatic datapoints", () => {
    const rows = sentComponentRows([LINES] as never, { review: REVIEW });
    expect(rows.map((row) => row.fileCount)).toEqual([0, 3, 0]);
    expect(rows[1].fileEntryIds).toEqual(["e1", "e2"]);
  });

  it("shows the sequestration component's real source and points to the Carbon ledger", () => {
    const [row] = sentComponentRows([[line({ componentId: "seq", displayName: "Sequestration", contract: { automaticSource: "sequestration" } })]] as never);
    expect(row.source).toBe(SENT_SOURCE.samples);
    expect(row.value).toBe(CARBON_LEDGER_POINTER);
    expect(row.valuePointer).toBe(true);
  });

  it("shows a component fixed in the template with its value, said once", () => {
    const [row] = sentComponentRows([[line({ componentId: "fixed", displayName: "Fixed", state: "filled" })]] as never, {
      review: review([binding("fixed", 0.5, "kg", "fixed")]),
    });
    expect(row.source).toBe(SENT_SOURCE.template);
    expect(row.value).toBe("0.5 kg");
  });

  it("shows the quantities from records, not the emission factors fixed beside them in the template", () => {
    const [row] = sentComponentRows([[line({ componentId: "ship", displayName: "Transport", state: "filled" })]] as never, {
      review: review([binding("ship", 0.272, "kgCO2e/kilometer/metric_ton", "fixed"), binding("ship", 40, "t·km")]),
    });
    expect(row.value).toBe("40 t·km");
  });

  it("shows a component left out of a follow-up Removal as not sent, never as none or not recorded", () => {
    const [row] = sentComponentRows([[line({ componentId: "prod", displayName: "Diesel", state: "filled" })]] as never, {
      review: review([], ["prod"]),
    });
    expect(row.source).toBe(SENT_SOURCE.notSent);
    expect(row.notSentReason).toBe("Sent with an earlier Removal.");
    expect(row.value).toBeNull();
  });

  it("never shows a blocked or unbindable component as sent, whatever its zero, and says so once", () => {
    const rows = sentComponentRows(
      [[
        line({ componentId: "blocked", displayName: "Blocked", state: "confirmedZero", blocker: { message: "Add a file for each emissions entry with a value." } }),
        line({ componentId: "unbindable", displayName: "Unbindable", state: "confirmedZero" }),
      ]] as never,
      { review: review([binding("blocked", 0, "kWh"), binding("unbindable", 0, "kWh")]), unbindableComponentIds: new Set(["unbindable"]) },
    );
    expect(rows.map((row) => row.source)).toEqual([SENT_SOURCE.notSent, SENT_SOURCE.notSent]);
    expect(rows.map((row) => row.value)).toEqual([null, null]);
    expect(rows[0].notSentReason).toBe("Add a file for each emissions entry with a value.");
    expect(rows[1].notSentReason).toContain("noma cannot submit");
  });

  it("adds the sources of several batches into one row for the Removal", () => {
    const rows = sentComponentRows([
      [line({ componentId: "t", displayName: "Travel", state: "filled", entries: [entry({ id: "a", documentCount: 1 })] })],
      [line({ componentId: "t", displayName: "Travel", state: "filled", entries: [entry({ id: "b", documentCount: 2 })] })],
    ] as never, { review: review([binding("t", 5, "L")]) });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("2 manual entries");
    expect(rows[0].fileCount).toBe(3);
  });
});

describe("ComponentsSent", () => {
  const ctx = {
    memberBatches: [{ id: BATCH_ID, code: "CB-26-001", startDate: "2026-09-01", endDate: "2026-09-30" }],
    emissionLinesByBatchId: { [BATCH_ID]: LINES },
    unbindableTemplateInputs: [],
  } as unknown as Pick<RemovalCertifyContext, "memberBatches" | "emissionLinesByBatchId" | "unbindableTemplateInputs">;

  it("lists every component with its value, source and files", () => {
    render(<ComponentsSent ctx={ctx} facilityId="facility-1" review={REVIEW} />);
    const list = screen.getByRole("list", { name: "Components sent" });

    const travel = within(list).getByText("Staff travel").closest("li")!;
    expect(within(travel).getAllByText("2 manual entries").length).toBeGreaterThan(0);
    expect(within(travel).getAllByText("3 files").length).toBeGreaterThan(0);
    expect(within(travel).getByText("30 L")).toBeTruthy();

    const zero = within(list).getByText("Pyrolyzer CO").closest("li")!;
    expect(within(zero).getByText("Recorded zero")).toBeTruthy();
    expect(within(zero).getByText("0 kWh")).toBeTruthy();
  });

  it("explains a component not sent once, in the source column", () => {
    render(<ComponentsSent ctx={ctx} facilityId="facility-1" review={review([binding("auto", 72, "kWh")], ["manual"])} />);
    const row = screen.getByText("Staff travel").closest("li")!;
    expect(within(row).getAllByText("Not sent")).toHaveLength(1);
    expect(within(row).getByRole("button", { name: "Why Staff travel is not sent" }).getAttribute("data-reason")).toBe("Sent with an earlier Removal.");
  });

  it("offers the file names behind a toggletip, reachable on a tap", () => {
    render(<ComponentsSent ctx={ctx} facilityId="facility-1" review={REVIEW} />);
    expect(screen.getAllByRole("button", { name: "File names for Staff travel" }).length).toBeGreaterThan(0);
  });

  it("hides the Files column in a batch where no component has files", () => {
    const noFiles = { ...ctx, emissionLinesByBatchId: { [BATCH_ID]: [LINES[0], LINES[2]] } } as unknown as typeof ctx;
    const { container } = render(<ComponentsSent ctx={noFiles} facilityId="facility-1" review={REVIEW} />);
    expect(container.querySelector("li[class*='120px']")).toBeNull();
    expect(screen.queryByText(/files?$/)).toBeNull();
  });

  it("renders nothing without lines", () => {
    const { container } = render(
      <ComponentsSent ctx={{ memberBatches: [], emissionLinesByBatchId: {}, unbindableTemplateInputs: [] } as never} facilityId="facility-1" review={null} />,
    );
    expect(container.textContent).toBe("");
  });
});
