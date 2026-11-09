import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardActivityItem } from "@/data-access/dashboard-overview";
import { activityRows, shortDay, todoRows } from "./shared";

const ZONE = "Africa/Dar_es_Salaam";
const item = (over: Partial<DashboardActivityItem>): DashboardActivityItem => ({
  id: "1",
  code: "PR-1",
  title: "Saved",
  dateIso: "2026-11-09T10:37:00Z",
  href: "/x",
  ...over,
});

/** "Nov 9" drops the year only in the current year, so the clock is pinned to 2026. */
const NOW = new Date("2026-11-09T12:00:00Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("activityRows", () => {
  it("shows the day and the facility-local time for a physical event", () => {
    expect(activityRows([item({})], ZONE)[0]?.meta).toBe("Nov 9, 13:37");
  });

  it("shows the day only for business dates (feedstock intake, applications)", () => {
    const [row] = activityRows([item({ dateIso: "2026-11-09T00:00:00Z", calendarDay: true })], "America/Los_Angeles");
    expect(row?.meta).toBe("Nov 9");
  });
});

describe("shortDay", () => {
  it("reads a date-only string as a calendar day in any zone", () => {
    expect(shortDay("2026-11-09", "America/Los_Angeles")).toBe("Nov 9");
  });

  it("adds the year for another year", () => {
    expect(shortDay("2025-11-09", "America/Los_Angeles")).toBe("Nov 9, 2025");
  });

  it("is null for no date", () => {
    expect(shortDay(null, ZONE)).toBeNull();
  });
});

describe("todoRows", () => {
  it("shows a record row's code before its day, and a grouped row's count", () => {
    const rows = todoRows(
      [
        { id: "a", entityCode: "PR-26-004", date: "2026-11-03T00:00:00Z", title: "Run missing mass data", href: "/x" },
        { id: "b", entityCode: "Production runs", count: 3, date: null, title: "Run missing mass data", href: "/y" },
      ],
      [],
    );
    expect(rows.map((row) => row.meta)).toEqual(["PR-26-004 · Nov 3", "3 affected"]);
  });
});
