// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CarriedEntriesPanel, CarriedEntriesSection, RevisionLateEntriesSection, type CarriedEntry } from "./carried-entries";

vi.mock("@/hooks/use-documents", () => ({
  useDocumentsForEntity: () => ({ data: [{ id: "d1", fileName: "diesel-receipt.pdf", uploadStatus: "uploaded" }] }),
}));

const ENTRY: CarriedEntry = {
  entryId: "e1", creditBatchCode: "CB-26-009", creditBatchId: "cb-9", occurredOn: "2026-09-14",
  componentId: "diesel", componentName: "Diesel use", value: { magnitude: "120", unit: "l" },
  evidenceDocumentIds: ["doc-1"], earlierRemovalCode: "RM-26-009", earlierRemovalId: "rm-9",
};

describe("CarriedEntriesPanel", () => {
  it("renders nothing without carried entries", () => {
    expect(render(<CarriedEntriesPanel entries={[]} facilityId="f1" />).container.innerHTML).toBe("");
    expect(render(<CarriedEntriesPanel entries={undefined} facilityId="f1" />).container.innerHTML).toBe("");
  });

  it("lists the entry with its batch and earlier Removal linked", () => {
    const { container } = render(<CarriedEntriesPanel entries={[ENTRY]} facilityId="f1" />);
    const panel = within(container);
    expect(panel.getByRole("heading", { name: "Emissions from other credit batches" })).toBeTruthy();
    expect(container.textContent).toContain("Included automatically. Each stays part of its own credit batch, and Isometric gets a note saying so.");
    expect(container.textContent).toContain("Diesel use");
    expect(container.textContent).toContain("Sep 14, 2026");
    expect(container.textContent).toContain("1 manual entry");
    expect(container.textContent).toContain("1 file");
    expect(panel.getAllByRole("link", { name: "CB-26-009" })[0].getAttribute("href")).toBe("/credit-batches/cb-9?facility=f1");
    expect(container.textContent).toContain("Recorded after RM-26-009 was sent.");
    expect(panel.getByRole("link", { name: "RM-26-009" }).getAttribute("href")).toBe("/certification/removals?facility=f1&removal=rm-9");
  });

  it("omits the earlier Removal line when the entry was not recorded after one", () => {
    const { container } = render(<CarriedEntriesPanel entries={[{ ...ENTRY, earlierRemovalCode: undefined, earlierRemovalId: undefined }]} facilityId="f1" />);
    expect(container.textContent).not.toContain("Recorded after");
  });
});

describe("CarriedEntriesSection", () => {
  it("renders nothing without carried entries", () => {
    expect(render(<CarriedEntriesSection entries={[]} facilityId="f1" sent={false} />).container.innerHTML).toBe("");
  });

  it.each([
    [false, "Included automatically. Sent when this Removal is submitted."],
    [true, "Sent with this Removal."],
  ])("says where it stands (sent: %s)", (sent, line) => {
    const { container } = render(<CarriedEntriesSection entries={[ENTRY]} facilityId="f1" sent={sent} />);
    expect(container.textContent).toContain(line);
    expect(container.textContent).toContain("Emissions from other credit batches");
    expect(container.textContent).toContain("diesel-receipt.pdf");
    expect(screen.getByRole("link", { name: "CB-26-009" }).getAttribute("href")).toBe("/credit-batches/cb-9?facility=f1");
    expect(screen.getByRole("link", { name: "RM-26-009" }).getAttribute("href")).toBe("/certification/removals?facility=f1&removal=rm-9");
  });
});

describe("RevisionLateEntriesSection", () => {
  it("renders nothing without late entries", () => {
    expect(render(<RevisionLateEntriesSection entries={[]} facilityId="f1" removalCode="RM-26-009" />).container.innerHTML).toBe("");
    expect(render(<RevisionLateEntriesSection entries={undefined} facilityId="f1" removalCode="RM-26-009" />).container.innerHTML).toBe("");
  });

  it("names the Removal in the title and says when the entry goes out", () => {
    const { container } = render(<RevisionLateEntriesSection entries={[ENTRY]} facilityId="f1" removalCode="RM-26-009" />);
    expect(container.textContent).toContain("Recorded after RM-26-009 was sent");
    expect(container.textContent).toContain("Goes out when this Removal is resubmitted.");
    expect(container.textContent).toContain("Diesel use");
    expect(container.textContent).toContain("120");
    expect(container.textContent).toContain("Sep 14, 2026");
    expect(container.textContent).toContain("diesel-receipt.pdf");
    expect(container.textContent).not.toContain("was sent.");
    expect(screen.getByRole("link", { name: "CB-26-009" }).getAttribute("href")).toBe("/credit-batches/cb-9?facility=f1");
  });
});

describe("RevisionLateEntriesSection paired entries", () => {
  it("shows every value of a paired entry on its own line", () => {
    const paired = { ...ENTRY, value: { magnitude: "40", unit: "l" }, values: [{ magnitude: "40", unit: "l" }, { magnitude: "0.85", unit: "kg/l" }] };
    const { container } = render(<RevisionLateEntriesSection entries={[paired]} facilityId="f1" removalCode="RM-26-009" />);
    const row = container.querySelector("[data-carried-entry]")!;
    const lines = [...row.querySelectorAll("span.font-mono > span")].map((node) => node.textContent);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("40");
    expect(lines[1]).toContain("0.85");
  });
});
