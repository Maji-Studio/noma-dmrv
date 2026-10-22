// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CARRY_WAITING_REASONS } from "@/lib/certification/emission-entry-carry";
import { LateEntryStatus } from "./late-entry-status";

const AFTER = { removalId: "rm-9", removalCode: "RM-26-009" };
const DEST = { removalId: "rm-10", removalCode: "RM-26-010", creditBatchCodes: ["CB-26-010"], creditBatchIds: ["cb-10"], anotherCreditBatch: true };

describe("LateEntryStatus", () => {
  it("renders nothing for an entry with no carry", () => {
    const { container } = render(<LateEntryStatus entry={{}} facilityId="f1" />);
    expect(container.innerHTML).toBe("");
  });

  it("says a draft Removal takes it, with linked codes", () => {
    const { container } = render(<LateEntryStatus entry={{ recordedAfter: AFTER, carry: { receiver: DEST, waitingReason: null } }} facilityId="f1" />);
    expect(container.textContent).toContain("Recorded after RM-26-009 was sent.");
    expect(container.textContent).toContain("Goes into RM-26-010 (credit batch CB-26-010).");
    expect(screen.getByRole("link", { name: "RM-26-010" }).getAttribute("href")).toBe("/certification/removals?facility=f1&removal=rm-10");
    expect(screen.getByRole("link", { name: "CB-26-010" }).getAttribute("href")).toBe("/credit-batches/cb-10?facility=f1");
    expect(screen.queryByText(/Waiting/)).toBeNull();
  });

  it("says a sent Removal reported it", () => {
    const { container } = render(<LateEntryStatus entry={{ recordedAfter: AFTER, reportedIn: DEST, carry: { receiver: null, waitingReason: null } }} facilityId="f1" />);
    expect(container.textContent).toContain("Reported in RM-26-010 (another credit batch).");
  });

  it.each([
    ["noDraft", "New Removal"],
    ["incompatibleTemplate", "Open Removal templates"],
    ["templateUnknown", "Open Removals"],
  ] as const)("shows the %s wait and its action", (reason, action) => {
    const { container } = render(<LateEntryStatus entry={{ recordedAfter: AFTER, carry: { receiver: null, waitingReason: reason } }} facilityId="f1" />);
    expect(container.textContent).toContain(CARRY_WAITING_REASONS[reason]);
    expect(screen.getByRole("link", { name: action })).toBeTruthy();
  });
});
