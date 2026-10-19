// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime } from "@/lib/format-utils";
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
function renderEntry(entry: ActivityItem = item, props: { showDate?: boolean } = {}): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<ActivityEntry item={entry} creditBatchId="batch-1" {...props} />);
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

  it("lists no fields on created and deleted rows", () => {
    for (const action of ["created", "deleted"] as const) {
      const row = renderEntry({ ...item, action, changes: undefined, changeLabels: undefined });
      expect(row.querySelectorAll('[data-testid="activity-field-change"]')).toHaveLength(0);
      expect(readText(row)).not.toMatch(/Wet mass|Notes|Recorded/);
    }
  });
});

describe("ActivityEntry meta", () => {
  it("puts who and when on one line under the title, on every row", () => {
    const row = renderEntry();
    const time = row.querySelector("time") as HTMLTimeElement;
    expect(time.getAttribute("datetime")).toBe(item.occurredAt.toISOString());
    expect(time.getAttribute("title")).toBe(formatDateTime(item.occurredAt));
    expect(readText(time.parentElement as Element)).toBe(`Ada Operator · ${formatTime(item.occurredAt)}`);
  });

  it("draws the record type in a circle node and dashes it for a deleted record", () => {
    const live = renderEntry().querySelector('[aria-hidden="true"].rounded-full');
    expect(live?.querySelector("svg")).not.toBeNull();
    const gone = renderEntry({ ...item, record: { ...item.record, deleted: true } });
    expect(gone.querySelector('[aria-hidden="true"].rounded-full')?.className).toContain("border-dashed");
    expect(gone.querySelector('[data-testid="activity-tombstone"]')).not.toBeNull();
  });

  it("shows the full date and time when asked", () => {
    const row = renderEntry(item, { showDate: true });
    expect(readText(row.querySelector("time") as Element)).toBe(formatDateTime(item.occurredAt));
  });
});
