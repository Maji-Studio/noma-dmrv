// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import type { CreditBatchTimelineFacts } from "@/data-access/credit-batch-timeline-facts";
import type { RecordLockView } from "@/lib/record-lock-view";
import {
  appliedDryLabel,
  creditBatchRowActions,
  CreditBatchListRow,
  CreditBatchListRows,
} from "./credit-batch-list-rows";

afterEach(cleanup);

const creditBatch = {
  id: "batch-1",
  code: "CB-26-009",
  facilityId: "facility-1",
  feedstockTypeName: "Chicken manure",
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  productionRunCount: 4,
  // The wet rollup must never reach the row.
  appliedWeightTons: 0.7,
} as CreditBatchWithRelations;

const facts: CreditBatchTimelineFacts = {
  creditBatchId: "batch-1",
  facilityId: "facility-1",
  producedDryKg: 900,
  appliedDryKg: 320,
  notInRemovalDryKg: 0,
  removalCodes: [],
};

const lockAt = (level: RecordLockView["level"]): RecordLockView => ({
  level, heldBy: [], usedBy: [], freeFields: [], howToFree: null, returnedBy: [],
});

function renderRow(overrides: Partial<Parameters<typeof CreditBatchListRow>[0]> = {}) {
  const props = {
    creditBatch,
    view: { state: "blocking" as const, blockingCount: 3 },
    readinessStatus: "ready" as const,
    facts,
    factsStatus: "ready" as const,
    lock: lockAt("open"),
    onView: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<CreditBatchListRows><CreditBatchListRow {...props} /></CreditBatchListRows>);
  return { props, row: screen.getByRole("listitem") };
}

describe("CreditBatchListRow", () => {
  it("shows code, feedstock, dates, the timeline state and the dry applied figure", () => {
    const { row } = renderRow();
    for (const text of ["Chicken manure", "Open", "Missing data", "Applied (dry)", "0.32 t"]) {
      expect(within(row).getAllByText(text).length).toBeGreaterThan(0);
    }
    // A phone drops the shared "CB-" prefix; the code stays whole in the text and the button's name.
    expect(within(row).getByRole("button", { name: "Open credit batch CB-26-009" }).textContent).toBe("CB-26-009");
    expect(row.textContent).toContain("Aug 1 to Aug 31, 2026");
    expect(row.textContent).not.toContain("0.70");
  });

  it("opens the batch from the row and from the code button", () => {
    const { props, row } = renderRow();
    fireEvent.click(row);
    fireEvent.click(within(row).getByRole("button", { name: "Open credit batch CB-26-009" }));
    expect(props.onView).toHaveBeenCalledTimes(2);
    expect(props.onView).toHaveBeenCalledWith(creditBatch);
  });

  it("shows only the Sent lock, not Open or In use", () => {
    renderRow();
    expect(document.querySelector("[data-record-lock]")).toBeNull();
    cleanup();
    renderRow({ lock: lockAt("inUse") });
    expect(document.querySelector("[data-record-lock]")).toBeNull();
    cleanup();
    renderRow({ lock: lockAt("sent"), view: { state: "submitted", blockingCount: 0 } });
    expect(document.querySelector("[data-record-lock='sent']")?.textContent).toContain("Sent");
  });
});

describe("appliedDryLabel", () => {
  it("waits while loading and never falls back to a figure it does not have", () => {
    expect(appliedDryLabel(facts, "loading")).toBeNull();
    expect(appliedDryLabel(facts, "failed")).toBe("Not available");
    expect(appliedDryLabel(undefined, "ready")).toBe("Not available");
    expect(appliedDryLabel(facts, "ready")).toBe("0.32 t");
  });
});

describe("creditBatchRowActions", () => {
  const handlers = { onView: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };

  it("marks only Delete as destructive", () => {
    const actions = creditBatchRowActions({ creditBatch, lock: lockAt("open"), ...handlers });
    actions.forEach((action) => action.onSelect());
    expect(handlers.onView).toHaveBeenCalledWith(creditBatch);
    expect(handlers.onEdit).toHaveBeenCalledWith(creditBatch);
    expect(handlers.onDelete).toHaveBeenCalledWith(creditBatch.id);
    expect(actions.map(({ label, destructive }) => [label, destructive])).toEqual([
      ["Open details", undefined],
      ["Edit", undefined],
      ["Delete", true],
    ]);
  });

  it("offers only Open details when Sent or before the lock answers", () => {
    expect(creditBatchRowActions({ creditBatch, lock: lockAt("sent"), ...handlers }).map(({ label }) => label)).toEqual(["Open details"]);
    expect(creditBatchRowActions({ creditBatch, lock: undefined, ...handlers }).map(({ label }) => label)).toEqual(["Open details"]);
  });
});
