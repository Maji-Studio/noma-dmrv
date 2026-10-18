// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordLockLink, RecordLockView } from "@/lib/record-lock-view";
import { RecordLockChip } from "./record-lock-chip";
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
      ? "Wait for Isometric to return the covering GHG Statement, then refresh its status."
      : level === "inUse" ? "Correct or remove the records that use it first." : null,
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

describe("RecordLockNotice", () => {
  it("renders nothing while Open or unknown", () => {
    const { container } = render(<><RecordLockNotice lock={view("open", [])} /><RecordLockNotice lock={undefined} /></>);
    expect(container.textContent).toBe("");
  });

  it("names the one record that uses it as a link, with how to free it", () => {
    render(<RecordLockNotice lock={view("inUse", [RUN])} />);
    expect(screen.getByRole("status").textContent).toBe(
      "In use by production run PR-26-004, so fields that feed its numbers are locked. Correct or remove the records that use it first.",
    );
    expect(screen.getByRole("link", { name: "production run PR-26-004" }).getAttribute("href"))
      .toBe(`/production-runs?facility=${FACILITY}&run=run-1`);
  });

  it("names two holders and counts the rest", () => {
    render(<RecordLockNotice lock={view("inUse", [PRODUCT, DELIVERY, LOSS])} />);
    expect(screen.getByRole("status").textContent).toBe(
      "In use by biochar product BP-26-021, delivery DL-26-003 and 1 more, so fields that feed their numbers are locked. Correct or remove the records that use it first.",
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("names the Removal by its period when Sent, linked to the Removals list", () => {
    render(<RecordLockNotice lock={view("sent", [REMOVAL])} />);
    expect(screen.getByRole("status").textContent).toBe(
      "Sent with Removal Jan 1 to Mar 31, 2026, so every field is locked. Wait for Isometric to return the covering GHG Statement, then refresh its status.",
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/certification/removals?facility=${FACILITY}&removal=removal-1`);
  });

  it("stays silent for a kind that keeps every field free while In use, but not once Sent", () => {
    const { container, rerender } = render(<RecordLockNotice lock={view("inUse", [REMOVAL])} inUseLocksNothing />);
    expect(container.textContent).toBe("");
    rerender(<RecordLockNotice lock={view("sent", [REMOVAL])} inUseLocksNothing />);
    expect(container.textContent).toContain("so every field is locked");
  });

  it("names a storage bin's latest stock record as a link when there is one", () => {
    render(<RecordLockNotice lock={view("inUse", [DELIVERY])} subject="storageBin" />);
    expect(screen.getByRole("status").textContent).toBe(
      "In use by its stock history, most recently delivery DL-26-003, so the storage type and feedstock type are locked.",
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
    expect(screen.getByRole("status").textContent).toBe("In use by its stock history, so the storage type and feedstock type are locked.");
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
    expect(inUse.textContent).toContain("In use by production run PR-26-004");
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
