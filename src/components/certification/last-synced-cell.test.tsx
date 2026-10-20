import { describe, expect, it } from "vitest";
import { lastSyncedText } from "./last-synced-cell";


describe("last synced", () => {
  it("says Never for a statement that was never synced", () => {
    expect(lastSyncedText(null)).toBe("Never");
  });

  it("formats a sync time with the shared date and time format", () => {
    expect(lastSyncedText(new Date(2026, 9, 7, 14, 30))).toBe("Oct 7, 2026, 14:30");
  });
});
