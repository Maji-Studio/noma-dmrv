import { describe, expect, it } from "vitest";
import type { DashboardActivityItem } from "@/data-access/dashboard-overview";
import { activityRows, shortDay } from "./shared";

const ZONE = "Africa/Dar_es_Salaam";
const item = (over: Partial<DashboardActivityItem>): DashboardActivityItem => ({
  id: "1",
  code: "PR-1",
  title: "Saved",
  dateIso: "2026-11-09T10:37:00Z",
  href: "/x",
  ...over,
});

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

  it("is null for no date", () => {
    expect(shortDay(null, ZONE)).toBeNull();
  });
});
