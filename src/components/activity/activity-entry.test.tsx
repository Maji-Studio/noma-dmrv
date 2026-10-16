// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityEntry } from "./activity-entry";
import type { ActivityItem } from "./activity-display";

const item: ActivityItem = {
  id: "event-1", action: "updated", entityType: "feedstock", entityId: "feed-1",
  changedFields: ["massWetKg", "moistureContentPercent", "notes", "status", "supplierId"],
  changes: {
    massWetKg: { from: "600", to: "650" },
    moistureContentPercent: { from: null, to: "14.2" },
    status: { from: "draft", to: "complete" },
    supplierId: { from: "0b8f8a52-7a8c-4d71-9a3e-0d7c2f1f7e11", to: null },
  },
  changeLabels: { supplierId: { from: { label: null, deleted: true, type: "supplier" }, to: null } },
  fromStatus: null, toStatus: null, fromRemote: null, toRemote: null, source: "form",
  occurredAt: new Date("2026-10-15T21:00:00Z"), registryAt: null, reasonCode: null,
  actor: { id: "user-1", name: "Ada Operator" }, record: { label: "FS-001", deleted: false, facilityId: null, facilityTimezone: null },
};

/** The rendered row as a DOM tree, so text is read the way a browser reads it. */
function renderEntry(): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<ActivityEntry item={item} creditBatchId="batch-1" />);
  return container;
}

const readText = (node: Element) => (node.textContent ?? "").replace(/\s+/g, " ").trim();

describe("ActivityEntry field lines", () => {
  it("reads each changed field as one phrase, with from and to for screen readers", () => {
    const row = renderEntry();
    const lines = [...row.querySelectorAll('[data-testid="activity-field-change"]')].map(readText);
    expect(lines).toEqual([
      "Wet mass (kg): from 600 to 650",
      "Moisture (%): from Not recorded to 14.2",
      "Notes: changed",
      "Supplier: from Deleted supplier to Not set",
    ]);
    expect([...row.querySelectorAll(".sr-only")].map((node) => node.textContent)).toContain("from ");
    const struck = [...row.querySelectorAll(".line-through")].map(readText);
    expect(struck).toEqual(["Deleted supplier"]);
    expect(row.innerHTML).not.toContain("0b8f8a52");
    // The status keeps the shared badges, not a text line.
    const status = [...row.querySelectorAll("p")].find((node) => node.textContent?.startsWith("Status"));
    expect(status?.textContent).toBe("StatusDraftComplete");
    expect(status?.querySelector('[aria-label="to"]')).not.toBeNull();
  });
});
