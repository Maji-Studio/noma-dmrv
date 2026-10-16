// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
  };
}

describe("RecordLockChip", () => {
  it.each([
    ["open", "Open", "neutral"],
    ["inUse", "In use", "warning"],
    ["sent", "Sent", "in-progress"],
  ] as const)("renders %s as %s on the %s ramp", (level, label, state) => {
    render(<RecordLockChip level={level} />);
    const chip = screen.getByText(label);
    expect(chip.getAttribute("data-record-lock")).toBe(level);
    const ramp = { neutral: "--st-off-bg", warning: "--st-wait-bg", "in-progress": "--st-run-bg" }[state];
    expect(chip.className).toContain(ramp);
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

  it("names a storage bin's stock history instead of a record", () => {
    render(<RecordLockNotice lock={view("inUse", [])} subject="storageBin" />);
    expect(screen.getByRole("status").textContent).toBe("In use by its stock history, so the storage type and feedstock type are locked.");
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
