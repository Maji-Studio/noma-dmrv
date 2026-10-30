// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CARRY_WAITING_REASONS } from "@/lib/certification/emission-entry-carry";
import { LateEntryStatus } from "./late-entry-status";
import { TemplatePermissionProvider } from "./template-permission";

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
    expect(container.textContent).toContain("Goes into RM-26-010 of credit batch CB-26-010.");
    expect(screen.getByRole("link", { name: "RM-26-010" }).getAttribute("href")).toBe("/removals?facility=f1&removal=rm-10");
    expect(screen.getByRole("link", { name: "CB-26-010" }).getAttribute("href")).toBe("/credit-batches/cb-10?facility=f1");
    expect(screen.queryByText(/Waiting/)).toBeNull();
  });

  it("says the entry goes into the earlier Removal revision with the existing code link", () => {
    const { container } = render(<LateEntryStatus entry={{ recordedAfter: AFTER, revisionOf: AFTER }} facilityId="f1" />);
    expect(container.textContent).toBe("Recorded after RM-26-009 was sent.Goes into the revision of RM-26-009.");
    expect(screen.getAllByRole("link", { name: "RM-26-009" }).map(link => link.getAttribute("href")))
      .toEqual(["/removals?facility=f1&removal=rm-9", "/removals?facility=f1&removal=rm-9"]);
  });

  it("names several credit batches", () => {
    const { container } = render(<LateEntryStatus entry={{ reportedIn: { ...DEST, creditBatchCodes: ["CB-1", "CB-2"], creditBatchIds: ["a", "b"] }, carry: { receiver: null, waitingReason: null } }} facilityId="f1" />);
    expect(container.textContent).toContain("Reported in RM-26-010 of credit batches CB-1, CB-2.");
  });

  it("says a sent Removal reported it", () => {
    const { container } = render(<LateEntryStatus entry={{ recordedAfter: AFTER, reportedIn: DEST, carry: { receiver: null, waitingReason: null } }} facilityId="f1" />);
    expect(container.textContent).toContain("Reported in RM-26-010 of credit batch CB-26-010.");
  });

  it.each([
    ["noDraft", "New Removal"],
    ["incompatibleTemplate", "Open Removal templates"],
    ["templateUnknown", "Open Removals"],
  ] as const)("shows the %s wait and its action", (reason, action) => {
    const { container } = render(
      <TemplatePermissionProvider canManage>
        <LateEntryStatus entry={{ recordedAfter: AFTER, carry: { receiver: null, waitingReason: reason } }} facilityId="f1" />
      </TemplatePermissionProvider>,
    );
    expect(container.textContent).toContain(CARRY_WAITING_REASONS[reason]);
    expect(screen.getByRole("link", { name: action })).toBeTruthy();
  });

  it("offers a member no templates action", () => {
    const { container } = render(<LateEntryStatus entry={{ recordedAfter: AFTER, carry: { receiver: null, waitingReason: "incompatibleTemplate" } }} facilityId="f1" />);
    expect(screen.queryByRole("link", { name: "Open Removal templates" })).toBeNull();
    expect(container.textContent).toContain("An Admin changes it in Settings, Removal templates.");
  });

  it("shows a wait without a Removal it was recorded after", () => {
    const { container } = render(<LateEntryStatus entry={{ carry: { receiver: null, waitingReason: "noDraft" } }} facilityId="f1" />);
    expect(container.textContent).not.toContain("Recorded after");
    expect(container.textContent).toContain(CARRY_WAITING_REASONS.noDraft);
    expect(screen.getByRole("link", { name: "New Removal" }).className).toContain("min-h-44");
  });

  it.each(["noDraft", "incompatibleTemplate", "templateUnknown"] as const)("shows the %s wait as a fact with no action link when read only", (reason) => {
    const { container } = render(
      <TemplatePermissionProvider canManage>
        <LateEntryStatus entry={{ recordedAfter: AFTER, carry: { receiver: null, waitingReason: reason } }} facilityId="f1" readOnly />
      </TemplatePermissionProvider>,
    );
    expect(container.textContent).toContain("Waiting for a Removal.");
    expect(container.textContent).not.toContain("Open the Removal to load it.");
    expect(container.textContent).not.toContain("Admin");
    expect(screen.queryByRole("link", { name: /Removal(s| templates)?$/ })).toBeNull();
  });
});
