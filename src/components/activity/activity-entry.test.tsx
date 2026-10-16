import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityEntry } from "./activity-entry";
import type { ActivityItem } from "./activity-display";

const item: ActivityItem = {
  id: "event-1", action: "updated", entityType: "feedstock", entityId: "feed-1",
  changedFields: ["massWetKg", "notes", "status", "supplierId"],
  changes: {
    massWetKg: { from: "600", to: "650" },
    status: { from: "draft", to: "complete" },
    supplierId: { from: "0b8f8a52-7a8c-4d71-9a3e-0d7c2f1f7e11", to: null },
  },
  changeLabels: { supplierId: { from: { label: null, deleted: true }, to: null } },
  fromStatus: null, toStatus: null, fromRemote: null, toRemote: null, source: "form",
  occurredAt: new Date("2026-10-15T21:00:00Z"), registryAt: null, reasonCode: null,
  actor: { id: "user-1", name: "Ada Operator" }, record: { label: "FS-001", deleted: false, facilityId: null },
};

function text(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

describe("ActivityEntry field lines", () => {
  it("reads each changed field as one phrase, with from and to for screen readers", () => {
    const html = renderToStaticMarkup(<ActivityEntry item={item} creditBatchId="batch-1" />);
    expect(html.match(/data-testid="activity-field-change"/g)).toHaveLength(3);
    expect(text(html)).toContain("Wet mass (kg): from 600 to 650");
    expect(text(html)).toContain("Notes: changed");
    expect(text(html)).toContain("Supplier: from Deleted supplier to Not set");
    expect(html).toContain('<span class="sr-only">from </span>');
    expect(html).toMatch(/line-through[^>]*>Deleted supplier</);
    expect(html).not.toContain("0b8f8a52");
    // The status keeps the shared badges, not a text line.
    expect(html).toMatch(/Status<\/span>.*Draft.*aria-label="to".*Complete/);
  });
});
