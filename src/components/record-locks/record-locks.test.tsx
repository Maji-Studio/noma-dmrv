// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { FormActions } from "@/components/forms/form-actions";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordLockLink, RecordLockView } from "@/lib/record-lock-view";
import { RecordLockChip, RecordLockOverviewChip, RecordLockSentMark } from "./record-lock-chip";
import { recordLockTitleMark } from "./record-lock-title-mark";
import { RecordLockFormFrame, recordLockSheetProps } from "./record-lock-sheet-props";
import { INTERRUPTED_HOW_TO_FREE, INTERRUPTED_HOW_TO_FREE_ONE, INTERRUPTED_MIXED_HOW_TO_FREE_ONE } from "@/lib/record-lock";
import { RecordLockNotice } from "./record-lock-notice";
import { RecordUsedBy } from "./record-used-by";

afterEach(cleanup);

const FACILITY = "facility-1";
const RUN: RecordLockLink = { kind: "productionRun", id: "run-1", label: "PR-26-004", facilityId: FACILITY };
const PRODUCT: RecordLockLink = { kind: "biocharProduct", id: "product-1", label: "BP-26-021", facilityId: FACILITY };
const DELIVERY: RecordLockLink = { kind: "delivery", id: "delivery-1", label: "DL-26-003", facilityId: FACILITY };
const LOSS: RecordLockLink = { kind: "stockEntry", id: "entry-1", label: "North hopper", facilityId: FACILITY };
const REMOVAL: RecordLockLink = {
  kind: "removal", id: "removal-1", label: null, facilityId: FACILITY,
  period: { startedOn: "2026-01-01", completedOn: "2026-03-31" },
};

function view(level: RecordLockView["level"], heldBy: RecordLockLink[], usedBy = heldBy): RecordLockView {
  return {
    level, heldBy, usedBy, freeFields: level === "sent" ? [] : ["code"],
    howToFree: level === "sent"
      ? "If Isometric sends the GHG Statement back, refresh its status to edit again."
      : level === "inUse" ? "To change them, first correct or remove those records." : null,
    returnedBy: [],
  };
}

describe("RecordLockChip", () => {
  it.each([
    ["open", "Open", "--color-background-white"],
    ["inUse", "In use", "--st-off-bg"],
    ["sent", "Sent", "--st-run-bg"],
  ] as const)("renders %s as %s on %s", (level, label, fill) => {
    render(<RecordLockChip level={level} />);
    const chip = screen.getByText(label);
    expect(chip.getAttribute("data-record-lock")).toBe(level);
    expect(chip.className).toContain(fill);
  });

  it("keeps Open and In use calm and apart, and only Sent in colour", () => {
    render(<><RecordLockChip level="open" /><RecordLockChip level="inUse" /><RecordLockChip level="sent" /></>);
    const [open, inUse, sent] = ["Open", "In use", "Sent"].map((label) => screen.getByText(label).className);
    expect(open).not.toBe(inUse);
    expect([open, inUse].some((classes) => /--st-(wait|run|ok|bad)/.test(classes))).toBe(false);
    expect(sent).toContain("--st-run");
  });
});

describe("overview surfaces show only Sent", () => {
  it.each([["open", "Open"], ["inUse", "In use"]] as const)("hides %s in the overview chip", (level, label) => {
    const { container } = render(<><RecordLockOverviewChip lock={view(level, [RUN])} /></>);
    expect(container.textContent).toBe("");
    expect(screen.queryByText(label)).toBeNull();
  });

  it("shows Sent in the overview chip", () => {
    render(<><RecordLockOverviewChip lock={view("sent", [REMOVAL])} /></>);
    expect(screen.getAllByText("Sent")).toHaveLength(1);
  });

  it("marks only Sent with a named lock icon, and renders nothing for other rows", () => {
    const mark = recordLockTitleMark<{ id: string }>({ a: view("inUse", [RUN]), b: view("sent", [REMOVAL]) });
    expect(mark({ id: "a" })).toBeNull();
    render(<>{mark({ id: "b" })}</>);
    const icon = screen.getByRole("img", { name: "Sent" });
    expect(icon.getAttribute("title")).toBe("Sent to Isometric");
    expect(icon.textContent).toBe("");
  });

  it("renders no sent mark for Open or In use", () => {
    const { container } = render(<><RecordLockSentMark lock={view("open", [])} /><RecordLockSentMark lock={undefined} /></>);
    expect(container.textContent).toBe("");
    expect(container.firstChild).toBeNull();
  });

  it("keeps all three levels in the sheet header badge", () => {
    for (const [level, label] of [["open", "Open"], ["inUse", "In use"], ["sent", "Sent"]] as const) {
      const { unmount } = render(<>{recordLockSheetProps({ lock: view(level, [RUN]), status: "ready" }).titleBadge}</>);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it("drops the In use badge where In use locks nothing, keeping Sent", () => {
    const inUse = recordLockSheetProps({ lock: view("inUse", [RUN]), status: "ready", inUseLocksNothing: true });
    expect(inUse.titleBadge).toBeUndefined();
    render(<>{recordLockSheetProps({ lock: view("sent", [REMOVAL]), status: "ready", inUseLocksNothing: true }).titleBadge}</>);
    expect(screen.getByText("Sent")).toBeTruthy();
  });
});

describe("Interrupted display", () => {
  const OTHER: RecordLockLink = { ...REMOVAL, id: "removal-2" };
  const allInterrupted = { ...view("sent", [REMOVAL, OTHER]), interruptedHolders: [REMOVAL, OTHER] };
  const mixed = { ...view("sent", [REMOVAL, OTHER]), interruptedHolders: [OTHER] };
  const normal = view("sent", [REMOVAL]);

  it("reads Interrupted in the sheet tag only when every holder is interrupted", () => {
    const tag = (lock: RecordLockView) => recordLockSheetProps({ lock, status: "ready" }).titleBadge;
    const { unmount } = render(<>{tag(allInterrupted)}</>);
    expect(screen.getByText("Interrupted").getAttribute("data-record-lock")).toBe("sent");
    // Interrupted takes the red of the Removal's own "Submission interrupted" badge, not Sent's.
    expect(screen.getByText("Interrupted").className).toContain("--st-bad");
    expect(screen.queryByText("Sent")).toBeNull();
    unmount();
    for (const lock of [mixed, normal]) {
      const r = render(<>{tag(lock)}</>);
      expect(screen.getByText("Sent")).toBeTruthy();
      expect(screen.queryByText("Interrupted")).toBeNull();
      r.unmount();
    }
  });

  it("names the overview mark Interrupted only when every holder is interrupted", () => {
    const { unmount } = render(<RecordLockSentMark lock={allInterrupted} />);
    const icon = screen.getByRole("img", { name: "Interrupted" });
    expect(icon.getAttribute("title")).toBe("Sending to Isometric was started and not finished");
    expect(icon.getAttribute("data-record-lock")).toBe("sent");
    unmount();
    for (const lock of [mixed, normal]) {
      const r = render(<RecordLockSentMark lock={lock} />);
      const sent = screen.getByRole("img", { name: "Sent" });
      expect(sent.getAttribute("title")).toBe("Sent to Isometric");
      r.unmount();
    }
  });

  it("labels tiles and credit batch rows Interrupted only when every holder is interrupted", () => {
    const { unmount } = render(<RecordLockOverviewChip lock={allInterrupted} />);
    expect(screen.getByText("Interrupted")).toBeTruthy();
    unmount();
    for (const lock of [mixed, normal]) {
      const r = render(<RecordLockOverviewChip lock={lock} />);
      expect(screen.getByText("Sent")).toBeTruthy();
      r.unmount();
    }
  });
});

describe("RecordLockNotice", () => {
  it("renders nothing while Open or unknown", () => {
    const { container } = render(<><RecordLockNotice lock={view("open", [])} /><RecordLockNotice lock={undefined} /></>);
    expect(container.textContent).toBe("");
  });

  it("names the one record that uses it as a link, with how to free it", () => {
    render(<RecordLockNotice lock={view("inUse", [RUN])} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Some fields can't be changed, because production run PR-26-004 uses its figures. To change them, first correct or remove that record.",
    );
    expect(screen.getByRole("link", { name: "production run PR-26-004" }).getAttribute("href"))
      .toBe(`/production-runs?facility=${FACILITY}&run=run-1`);
  });

  it("names two holders and counts the rest", () => {
    render(<RecordLockNotice lock={view("inUse", [PRODUCT, DELIVERY, LOSS])} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Some fields can't be changed, because biochar product BP-26-021, delivery DL-26-003 and 1 more use its figures. To change them, first correct or remove those records.",
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("names the Removal by its period when Sent, linked to the Removals list", () => {
    render(<RecordLockNotice lock={view("sent", [REMOVAL])} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Nothing can be changed, because this was sent to Isometric with Removal Jan 1 to Mar 31, 2026. If Isometric sends the GHG Statement back, refresh its status to edit again.",
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/certification/removals?facility=${FACILITY}&removal=removal-1`);
  });

  it("says sending was started and not finished for an interrupted Removal", () => {
    const interrupted = { ...view("sent", [REMOVAL]), interruptedHolders: [REMOVAL], howToFree: INTERRUPTED_HOW_TO_FREE_ONE };
    render(<RecordLockNotice lock={interrupted} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Nothing can be changed, because sending Removal Jan 1 to Mar 31, 2026 to Isometric was started and not finished. To edit again, delete or resume that Removal, or review its records in Isometric.",
    );
  });

  it("names several interrupted Removals", () => {
    const other: RecordLockLink = { ...REMOVAL, id: "removal-2", period: { startedOn: "2026-04-01", completedOn: "2026-06-30" } };
    const interrupted = { ...view("sent", [REMOVAL, other]), interruptedHolders: [REMOVAL, other], howToFree: INTERRUPTED_HOW_TO_FREE };
    render(<RecordLockNotice lock={interrupted} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Nothing can be changed, because sending Removal Jan 1 to Mar 31, 2026 and Removal Apr 1 to Jun 30, 2026 to Isometric was started and not finished. To edit again, delete or resume those Removals, or review their records in Isometric.",
    );
  });

  it("names the sent and the unfinished Removal separately when holders differ", () => {
    const other: RecordLockLink = { ...REMOVAL, id: "removal-2", period: { startedOn: "2026-04-01", completedOn: "2026-06-30" } };
    const mixed = { ...view("sent", [REMOVAL, other]), interruptedHolders: [other], howToFree: INTERRUPTED_MIXED_HOW_TO_FREE_ONE };
    render(<RecordLockNotice lock={mixed} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Nothing can be changed, because this was sent to Isometric with Removal Jan 1 to Mar 31, 2026, and sending Removal Apr 1 to Jun 30, 2026 was started and not finished. To edit again, delete or resume that Removal, and wait for Isometric to send the GHG Statement back.",
    );
  });

  it("stays silent for a kind that keeps every field free while In use, but not once Sent", () => {
    const { container, rerender } = render(<RecordLockNotice lock={view("inUse", [REMOVAL])} inUseLocksNothing />);
    expect(container.textContent).toBe("");
    rerender(<RecordLockNotice lock={view("sent", [REMOVAL])} inUseLocksNothing />);
    expect(container.textContent).toContain("Nothing can be changed");
  });

  it("names a storage bin's latest stock record as a link when there is one", () => {
    render(<RecordLockNotice lock={view("inUse", [DELIVERY])} subject="storageBin" />);
    expect(screen.getByRole("status").textContent).toBe(
      "Storage type and feedstock type can't be changed, because stock has already been recorded in this bin. Latest: delivery DL-26-003.",
    );
    expect(screen.getByRole("link", { name: "delivery DL-26-003" })).toBeTruthy();
  });

  it("offers an in-place retry when the lock read fails", () => {
    const retry = vi.fn();
    render(<RecordLockNotice lock={undefined} status="error" onRetry={retry} />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't check whether this record can change. Try again.");
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalled();
  });

  it("names a storage bin's stock history instead of a record", () => {
    render(<RecordLockNotice lock={view("inUse", [])} subject="storageBin" />);
    expect(screen.getByRole("status").textContent).toBe("Storage type and feedstock type can't be changed, because stock has already been recorded in this bin.");
  });
});

describe("returned by Isometric", () => {
  const STATEMENT: RecordLockLink = {
    kind: "ghgStatement", id: "statement-1", label: null, facilityId: FACILITY,
    period: { startedOn: "2026-07-01", completedOn: "2026-09-30" }, endsOn: "2026-09-30",
  };
  const returnedView = (level: RecordLockView["level"], status: string) => ({
    ...view(level, level === "inUse" ? [RUN] : []),
    returnedBy: [{ removal: REMOVAL, statement: STATEMENT, statementStatus: status }],
  });

  it("says where the corrections go, then keeps the In use line", () => {
    render(<RecordLockNotice lock={returnedView("inUse", "FAILED_VERIFICATION")} />);
    const [returned, inUse] = screen.getAllByRole("status");
    expect(returned.textContent).toBe(
      "Returned by IsometricGHG Statement Jul 1 to Sep 30, 2026 failed verification. Changes here go to Removal Jan 1 to Mar 31, 2026 when you resubmit it.",
    );
    expect(screen.getByRole("link", { name: "GHG Statement Jul 1 to Sep 30, 2026" }).getAttribute("href"))
      .toBe(`/certification/ghg-statements?facility=${FACILITY}&statement=statement-1`);
    expect(inUse.textContent).toContain("because production run PR-26-004 uses its figures");
  });

  it("names a statement back in draft, and shows the line on an Open record too", () => {
    render(<RecordLockNotice lock={returnedView("open", "DRAFT")} />);
    expect(screen.getByRole("status").textContent).toContain("GHG Statement Jul 1 to Sep 30, 2026 is back in draft.");
  });

  it("shows the returned line even for a kind whose In use locks nothing", () => {
    render(<RecordLockNotice lock={returnedView("inUse", "FAILED_VERIFICATION")} inUseLocksNothing />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText("Returned by Isometric")).toBeTruthy();
  });

  it("names a statement without a start by its end date", () => {
    render(<RecordLockNotice lock={{ ...returnedView("open", "FAILED_VERIFICATION"), returnedBy: [{ removal: REMOVAL, statement: { ...STATEMENT, period: null }, statementStatus: "FAILED_VERIFICATION" }] }} />);
    expect(screen.getByRole("link", { name: "GHG Statement ending Sep 30, 2026" })).toBeTruthy();
  });
});

describe("RecordUsedBy", () => {
  it("lists every record that uses it, linking those with a sheet", () => {
    render(<RecordUsedBy lock={view("sent", [REMOVAL], [PRODUCT, LOSS])} />);
    expect(screen.getByText("Used by")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Biochar product BP-26-021" }).getAttribute("href"))
      .toBe(`/biochar-products?facility=${FACILITY}&biocharProduct=product-1`);
    expect(screen.getByText("Stock entry in North hopper").closest("a")).toBeNull();
  });

  it("answers None when nothing uses it, and nothing before the read answers", () => {
    const { container, rerender } = render(<RecordUsedBy lock={undefined} />);
    expect(container.textContent).toBe("");
    rerender(<RecordUsedBy lock={view("open", [])} />);
    expect(screen.getByText("None")).toBeTruthy();
  });

  it("counts storage bin references", () => {
    render(<RecordUsedBy lock={view("inUse", [], [{ kind: "binReference", id: "feedstock batches", label: "feedstock batches", facilityId: FACILITY, count: 12 }])} />);
    expect(screen.getByText("Feedstock batches (12)")).toBeTruthy();
  });
});

describe("RecordLockFormFrame refusal slot", () => {
  it("shows a refusal above the lock line once the record is Sent, with focus and no Save", () => {
    const sent = view("sent", [REMOVAL]);
    render(
      <RecordLockFormFrame lock={sent} status="ready">
        <FormActions errorMessage="Locked. Its Removal was sent." submitLabel="Save record" />
      </RecordLockFormFrame>,
    );
    const box = document.querySelector<HTMLElement>("[data-top-refusal]");
    expect(box?.textContent).toContain("Your changes were not saved.");
    expect(document.activeElement).toBe(box);
    expect(screen.queryByRole("button", { name: "Save record" })).toBeNull();
    const lockLine = screen.getByRole("status");
    expect(box!.compareDocumentPosition(lockLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
