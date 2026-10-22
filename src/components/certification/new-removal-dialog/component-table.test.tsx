// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberCreditBatch } from "@/fn/certification/certify-context";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label }: { label?: string }) => <button type="button" aria-label={label} />,
}));
vi.mock("@/hooks/use-documents", () => ({ useDocumentsForEntity: () => ({ data: [] }) }));

import { ComponentTable, jumpToComponentRow } from "./component-table";
import {
  buildComponentTable,
  componentRows,
  ESTIMATE_POINTER,
  SENT_SOURCE,
  type ComponentTableInput,
} from "./component-table-model";
import { BlockedComponentsNotice } from "./blocked-components-notice";

const BATCH_A = { id: "batch-a", code: "CB-26-001", startDate: "2026-07-01", endDate: "2026-07-31", appliedDryWeightTons: 12.4 } as MemberCreditBatch;
const BATCH_B = { id: "batch-b", code: "CB-26-002", startDate: "2026-08-01", endDate: "2026-08-31", appliedDryWeightTons: 9.8 } as MemberCreditBatch;
const BLOCK_MESSAGE = "Add a file for each emissions entry with a value.";

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
const HERE = { creditBatchId: "batch-a", creditBatchCode: "CB-26-001", claimingRemovalId: null, claimingRemovalCode: null, contribution: "production-and-delivery" } as const;
const EARLIER = { creditBatchId: "batch-b", creditBatchCode: "CB-26-002", claimingRemovalId: "rm-3", claimingRemovalCode: "RM-26-003", contribution: "delivery-only" } as const;

function input(lines: unknown[][], overrides: Partial<ComponentTableInput> = {}): ComponentTableInput {
  const batches = [BATCH_A, BATCH_B].slice(0, lines.length);
  return {
    batches,
    linesByBatchId: Object.fromEntries(batches.map((batch, index) => [batch.id, lines[index]])) as never,
    review: null,
    isLoading: false,
    ledger: { claims: [HERE], inputs: [] },
    facilityId: "facility-1",
    ...overrides,
  };
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
const REVIEW = review([binding("auto", 72, "kWh"), binding("manual", 30, "L"), binding("zero", 0, "kWh")]);

afterEach(cleanup);

describe("componentRows", () => {
  it("names the sources, the figures the review sends and the files of the entries sent", () => {
    const rows = componentRows(input([LINES], { review: REVIEW }));
    expect(rows.map((row) => row.source)).toEqual([SENT_SOURCE.automatic, "2 manual entries", SENT_SOURCE.zero]);
    expect(rows.map((row) => row.figure?.text)).toEqual(["72 kWh", "30 L", "0 kWh"]);
    expect(rows.map((row) => row.fileCount)).toEqual([0, 3, 0]);
    expect(rows[1].fileEntryIds).toEqual(["e1", "e2"]);
    expect(rows.every((row) => row.state === "included")).toBe(true);
  });

  it("shows only what this Removal sends when a batch has more automatic records than the Removal includes", () => {
    const lines = [line({
      componentId: "ship", displayName: "Biochar transport", state: "filled",
      records: { source: "deliveries", count: 2, figure: { magnitude: "100", unit: "tonne * km" } },
      automaticFigure: { magnitude: "100", unit: "tonne * km" },
    })];
    const [row] = componentRows(input([lines], { review: review([binding("ship", 40, "t·km")]) }));
    expect(row.figure?.text).toBe("40 t·km");
  });

  it("shows quantities from records, not the emission factors fixed beside them in the template", () => {
    const [row] = componentRows(input([[line({ componentId: "ship", state: "filled" })]], {
      review: review([binding("ship", 0.272, "kgCO2e/kilometer/metric_ton", "fixed"), binding("ship", 40, "t·km")]),
    }));
    expect(row.figure?.text).toBe("40 t·km");
  });

  it("points the sequestration component to the estimate, quietly, with Samples as its source", () => {
    const [row] = componentRows(input([[line({ componentId: "seq", contract: { automaticSource: "sequestration" } })]], { review: review([]) }));
    expect(row.source).toBe(SENT_SOURCE.samples);
    expect(row.figure).toEqual({ text: ESTIMATE_POINTER, quiet: true });
  });

  it("adds the entries of several batches into one row for the Removal", () => {
    const rows = componentRows(input([
      [line({ componentId: "t", displayName: "Travel", state: "filled", entries: [entry({ id: "a", documentCount: 1 })] })],
      [line({ componentId: "t", displayName: "Travel", state: "filled", entries: [entry({ id: "b", documentCount: 2 })] })],
    ], { review: review([binding("t", 5, "L")]) }));
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("2 manual entries");
    expect(rows[0].fileCount).toBe(3);
  });

  describe("blocked, sent earlier and included with no figure read differently", () => {
    it("a blocked component says what to do and where, whatever its recorded zero, and shows no figure", () => {
      const lines = [[line({ componentId: "ok" })], [line({
        componentId: "lab", displayName: "Lab electricity", state: "confirmedZero",
        blocker: { code: "entryMissingEvidence", message: BLOCK_MESSAGE, fixTarget: "emissions", lineRef: { componentId: "lab", displayName: "Lab electricity" } },
      })]];
      const rows = componentRows(input(lines, { review: review([binding("lab", 0, "kWh")]) }));
      const lab = rows.find((row) => row.componentId === "lab")!;
      expect(lab.state).toBe("blocked");
      expect(lab.figure).toBeNull();
      expect(lab.blocked?.message).toBe(BLOCK_MESSAGE);
      expect(lab.blocked?.batchCodes).toEqual(["CB-26-002"]);
      expect(lab.blocked?.fixes).toEqual([
        { label: "Review emissions", href: expect.stringContaining("batch-b"), batchCode: "CB-26-002" },
      ]);
      expect(lab.earlier).toBeNull();
    });

    it("an unbindable component is blocked and links to the Removal templates", () => {
      const [row] = componentRows(input([[line({ componentId: "u", state: "filled" })]], {
        review: review([]), unbindableComponentIds: new Set(["u"]),
      }));
      expect(row.state).toBe("blocked");
      expect(row.blocked?.message).toContain("noma cannot submit");
      expect(row.blocked?.fixes[0].href).toContain("/settings/removal-templates");
    });

    it("a component an earlier Removal sent is its own state, with that Removal, and no figure", () => {
      const [row] = componentRows(input([[line({ componentId: "prod", state: "filled" })]], {
        review: review([binding("prod", 5, "L")], ["prod"]),
        ledger: { claims: [EARLIER], inputs: [] },
      }));
      expect(row.state).toBe("earlier");
      expect(row.earlier?.removals).toEqual([{ id: "rm-3", code: "RM-26-003" }]);
      expect(row.figure).toBeNull();
      expect(row.blocked).toBeNull();
    });

    it("an included component with no figure leaves the figure out", () => {
      const [row] = componentRows(input([[line({ componentId: "bare", state: "empty" })]], { review: review([]) }));
      expect(row.state).toBe("included");
      expect(row.figure).toBeNull();
      expect(row.source).toBe(SENT_SOURCE.none);
    });

    it("an included component whose transport has no figure says why, in the ledger's words", () => {
      const [row] = componentRows(input([[line({ componentId: "ft", state: "filled", contract: { automaticSource: "feedstock-transport" } })]], {
        review: review([]),
        ledger: { claims: [HERE], inputs: [{ id: "feedstock-transport", component: "Feedstock transport", input: "Mass and distance", magnitude: null, unit: "t·km", missingReason: "No legs recorded" }] },
      }));
      expect(row.state).toBe("included");
      expect(row.figure).toEqual({ text: "No legs recorded", quiet: true });
    });
  });
});

describe("buildComponentTable", () => {
  it("names each credit batch once with its production claim", () => {
    const table = buildComponentTable(input([LINES, LINES], { review: REVIEW, ledger: { claims: [HERE, EARLIER], inputs: [] } }));
    expect(table.batches.map((batch) => batch.claim)).toEqual([
      { kind: "here" },
      { kind: "earlier", removalId: "rm-3", removalCode: "RM-26-003" },
    ]);
  });

  it("while the review compiles, shows every figure as not yet computed and no final state", () => {
    const table = buildComponentTable(input([LINES], { isLoading: true }));
    expect(table.loading).toBe(true);
    expect(table.rows.map((row) => row.figure)).toEqual(Array(3).fill({ text: "Not yet computed", quiet: true }));
  });

  it("lists no rows without a compiled review, but still names the batches", () => {
    const table = buildComponentTable(input([LINES]));
    expect(table.rows).toEqual([]);
    expect(table.batches).toHaveLength(1);
  });
});

describe("ComponentTable", () => {
  const rows = (ledgerClaims = [HERE, EARLIER]) => {
    const lines = [
      [line({ componentId: "auto", displayName: "Metered electricity", state: "filled", automaticFigure: { magnitude: "72", unit: "kWh" } }),
        line({ componentId: "prod", displayName: "Kiln construction", state: "filled" })],
      [line({ componentId: "auto", displayName: "Metered electricity", state: "filled" }),
        line({ componentId: "prod", displayName: "Kiln construction", state: "filled" }),
        line({ componentId: "lab", displayName: "Lab electricity", state: "missingEvidence",
          blocker: { code: "entryMissingEvidence", message: BLOCK_MESSAGE, fixTarget: "emissions", lineRef: { componentId: "lab", displayName: "Lab electricity" } } })],
    ];
    lines[0].push(line({ componentId: "lab", displayName: "Lab electricity", state: "filled" }));
    return buildComponentTable(input(lines, {
      review: review([binding("auto", 72, "kWh")], ["prod"]),
      ledger: { claims: ledgerClaims, inputs: [] },
    }));
  };

  it("names the batches once in the header, with dates, dry tonnes and the production claim", () => {
    render(<ComponentTable table={rows()} facilityId="facility-1" />);
    const region = screen.getByRole("region", { name: "Components" });
    expect(within(region).getAllByText("CB-26-001")).toHaveLength(1);
    expect(within(region).getByText("Production emissions in this Removal")).toBeTruthy();
    // The header says where batch CB-26-002's production emissions went; the row says which component.
    const links = within(region).getAllByRole("link", { name: /RM-26-003/ });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toContain("removal=rm-3");
    expect(within(region).getByText("12.4 t")).toBeTruthy();
  });

  it("reads a blocked row as a state word, what to do and a link, on a white row", () => {
    render(<ComponentTable table={rows()} facilityId="facility-1" />);
    const row = screen.getByText("Lab electricity").closest("li")!;
    expect(within(row).getByText("Blocked")).toBeTruthy();
    expect(within(row).getByText(BLOCK_MESSAGE)).toBeTruthy();
    expect(within(row).getByRole("link", { name: /Review emissions on CB-26-002/ })).toBeTruthy();
    expect(row.className).not.toContain("st-bad");
    expect(within(row).queryByText("Not applicable")).toBeNull();
  });

  it("reads a component an earlier Removal sent as Sent earlier with a link, never as not applicable", () => {
    render(<ComponentTable table={rows()} facilityId="facility-1" />);
    const row = screen.getByText("Kiln construction").closest("li")!;
    expect(within(row).getByText("Sent earlier")).toBeTruthy();
    expect(within(row).getByRole("link", { name: /RM-26-003/ })).toBeTruthy();
    expect(within(row).queryByText(/Not applicable|Not available|Blocked/)).toBeNull();
  });

  it("hides the Included state on a phone, where the row already reads as fine", () => {
    render(<ComponentTable table={rows()} facilityId="facility-1" />);
    const row = screen.getByText("Metered electricity").closest("li")!;
    expect(within(row).getByText("Included").parentElement!.className).toContain("hidden md:block");
  });

  it("states no Included while the review compiles", () => {
    const table = buildComponentTable(input([LINES], { isLoading: true }));
    render(<ComponentTable table={table} facilityId="facility-1" />);
    expect(screen.queryByText("Included")).toBeNull();
    expect(screen.getAllByText("Not yet computed")).toHaveLength(3);
  });

  it("offers the file names behind a toggletip", () => {
    render(<ComponentTable table={buildComponentTable(input([LINES], { review: REVIEW }))} facilityId="facility-1" />);
    expect(screen.getByRole("button", { name: "File names for Staff travel" })).toBeTruthy();
  });
});

describe("BlockedComponentsNotice", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
  });

  function setup() {
    const lines = [[line({ componentId: "lab", displayName: "Lab electricity", state: "missingEvidence",
      blocker: { code: "entryMissingEvidence", message: BLOCK_MESSAGE, fixTarget: "emissions", lineRef: { componentId: "lab", displayName: "Lab electricity" } } })]];
    const table = buildComponentTable(input(lines, { review: review([]) }));
    const blockers = [
      { code: "entryMissingEvidence", message: BLOCK_MESSAGE, fixTarget: "emissions", lineRef: { componentId: "lab", displayName: "Lab electricity" } },
      { code: "legacy", message: "Delivery DL-1 has no proof of delivery.", fixTarget: null },
    ] as never;
    render(
      <>
        <BlockedComponentsNotice blockers={blockers} blockedRows={table.rows} facilityId="facility-1" memberBatchIds={["batch-a"]} />
        <ComponentTable table={table} facilityId="facility-1" />
      </>,
    );
  }

  it("names the blocked component with its credit batch and keeps blockers the table cannot show", () => {
    setup();
    const notice = screen.getByRole("alert");
    expect(within(notice).getByRole("button", { name: "Lab electricity" })).toBeTruthy();
    expect(notice.textContent).toContain("on CB-26-001");
    expect(notice.textContent).toContain("Delivery DL-1 has no proof of delivery.");
    // What to do is said once, in the row.
    expect(notice.textContent).not.toContain(BLOCK_MESSAGE);
  });

  it("scrolls the table to the row and moves focus to it", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Lab electricity" }));
    const row = screen.getByText(BLOCK_MESSAGE).closest("li")!;
    expect(document.activeElement).toBe(row);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("does nothing for a row that is not there", () => {
    expect(() => jumpToComponentRow("missing")).not.toThrow();
  });
});
