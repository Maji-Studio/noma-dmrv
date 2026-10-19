// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CreditBatchMilestone } from "@/lib/credit-batches/batch-page";
import { CreditBatchProgressCompact, progressFocusIndex } from "./credit-batch-progress-compact";

const step = (key: CreditBatchMilestone["key"], label: string, state: CreditBatchMilestone["state"], extra: Partial<CreditBatchMilestone> = {}): CreditBatchMilestone =>
  ({ key, label, state, caption: null, ...extra });

const missing: CreditBatchMilestone[] = [
  step("data", "Missing data", "current", { count: 2 }),
  step("removal", "Removal submitted", "todo"),
  step("verified", "Verified", "todo"),
  step("issued", "Credits issued", "todo"),
];

describe("progressFocusIndex", () => {
  it("names the current or failed step, else the last done one, else the first", () => {
    expect(progressFocusIndex(missing)).toBe(0);
    const failed = missing.map((s, i) => (i === 0 ? { ...s, state: "done" as const } : i === 2 ? { ...s, state: "failed" as const } : s));
    expect(progressFocusIndex(failed)).toBe(2);
    expect(progressFocusIndex(missing.map((s) => ({ ...s, state: "done" as const })))).toBe(3);
    expect(progressFocusIndex(missing.map((s) => ({ ...s, state: "todo" as const })))).toBe(0);
  });
});

describe("CreditBatchProgressCompact", () => {
  it("renders one 44px trigger naming the step, its blocking count and its place", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<CreditBatchProgressCompact steps={missing} />);
    const trigger = container.querySelector('[data-testid="credit-batch-progress-trigger"]') as HTMLButtonElement;
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.className).toContain("min-h-44");
    const text = (trigger.textContent ?? "").replace(/\s+/g, " ").trim();
    expect(text).toBe("Missing data2Step 1 of 4");
    expect(trigger.querySelector('[aria-label="2 blocking items"]')).not.toBeNull();
    // The four-step list mounts only while the popover is open.
    expect(container.querySelector("ol")).toBeNull();
  });
});
