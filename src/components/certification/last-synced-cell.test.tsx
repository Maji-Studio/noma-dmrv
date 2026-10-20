import { describe, expect, it } from "vitest";
import type { Row } from "@tanstack/react-table";
import {
  lastSyncedSortingFn,
  lastSyncedSortValue,
  lastSyncedText,
} from "./last-synced-cell";

type Item = { lastSyncedAt: Date | string | null };
const row = (lastSyncedAt: Item["lastSyncedAt"]) => ({ original: { lastSyncedAt } }) as Row<Item>;

describe("last synced", () => {
  it("says Never for a statement that was never synced", () => {
    expect(lastSyncedText(null)).toBe("Never");
  });

  it("formats a sync time with the shared date and time format", () => {
    expect(lastSyncedText(new Date(2026, 9, 7, 14, 30))).toBe("Oct 7, 2026, 14:30");
  });

  it("sorts chronologically, not alphabetically", () => {
    const older = row("2026-09-01T10:00:00.000Z");
    const newer = row(new Date("2026-10-05T09:00:00.000Z"));
    expect(lastSyncedSortingFn(older, newer)).toBeLessThan(0);
    expect(lastSyncedSortingFn(newer, older)).toBeGreaterThan(0);
  });

  it("gives never-synced rows no sort value so sortUndefined keeps them last", () => {
    expect(lastSyncedSortValue(null)).toBeUndefined();
    expect(lastSyncedSortValue(new Date(2026, 9, 7, 14, 30))).toBe("Oct 7, 2026, 14:30");
  });
});
