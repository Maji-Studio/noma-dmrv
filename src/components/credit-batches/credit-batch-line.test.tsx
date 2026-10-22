// @vitest-environment jsdom
/** The several-batch line: first code plus a +N button listing every batch. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CreditBatchLine } from "./credit-batch-line";
import { describeRecordCreditBatchLine } from "./record-credit-batch-line-copy";

afterEach(cleanup);

const batches = [
  { id: "b1", code: "CB-26-001", startDate: "2026-01-01", endDate: "2026-03-31" },
  { id: "b2", code: "CB-26-002", startDate: "2026-04-01", endDate: "2026-06-30" },
  { id: "b3", code: "CB-26-003", startDate: "2026-07-01", endDate: "2026-09-30" },
];

describe("CreditBatchLine with several batches", () => {
  it("shows the first code and +N, and the +N list names every batch", async () => {
    render(<CreditBatchLine copy={describeRecordCreditBatchLine("delivery", { state: "loaded", batches })} />);
    expect(screen.getByRole("status").textContent).toContain("Credit batches: ");
    expect(screen.queryByRole("link", { name: /CB-26-002/ })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Show all 3 credit batches" });
    expect(trigger.textContent).toBe("+2");
    fireEvent.click(trigger);
    for (const b of batches) {
      const links = await screen.findAllByRole("link", { name: new RegExp(b.code) });
      for (const link of links) expect(link.getAttribute("target")).toBe("_blank");
    }
    expect(screen.getAllByRole("link", { name: /CB-26-003/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Jul 1 to Sep 30, 2026|Jul 1 to Sep 30/)).toBeTruthy();
  });

  it("joins two possible batches with or, and hides the window on phones", () => {
    const copy = describeRecordCreditBatchLine("delivery", {
      state: "preview",
      preview: { batches: batches.slice(0, 2), heldOut: false, basis: "source", sourceRunCount: 2, unbatchedRunCount: 0 },
    });
    render(<CreditBatchLine copy={copy} />);
    expect(screen.getByRole("status").textContent).toContain("Credit batch: CB-26-001 (opens in a new tab) or CB-26-002");
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("puts a single batch's window in a span hidden below 640px", () => {
    const copy = describeRecordCreditBatchLine("delivery", {
      state: "preview",
      preview: { batches: batches.slice(0, 1), heldOut: false, basis: "planned", sourceRunCount: 1, unbatchedRunCount: 0 },
    });
    render(<CreditBatchLine copy={copy} />);
    const span = screen.getByText(/Jan 1 to Mar 31/);
    expect(span.className).toContain("hidden");
    expect(span.className).toContain("sm:inline");
  });

  it("has no +N button for one batch", () => {
    render(<CreditBatchLine copy={describeRecordCreditBatchLine("feedstock", { state: "loaded", batches: batches.slice(0, 1) })} />);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });
});
