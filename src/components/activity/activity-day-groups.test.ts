import { describe, expect, it } from "vitest";
import { activityDayLabel, groupActivityByDay } from "./activity-day-groups";
import type { ActivityItem } from "./activity-display";

const at = (value: Date, actor = "u1") => ({ id: `${value.toISOString()}${actor}`, occurredAt: value, actor: { id: actor }, source: "form" }) as ActivityItem;

describe("activity day groups", () => {
  it("labels today, yesterday and older days", () => {
    const now = new Date();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    expect(activityDayLabel(now)).toBe("Today");
    expect(activityDayLabel(yesterday)).toBe("Yesterday");
    expect(activityDayLabel(new Date(2026, 0, 5, 12))).toBe("Jan 5, 2026");
  });

  it("groups consecutive items of one day and keeps the order", () => {
    const first = at(new Date(2026, 0, 5, 15));
    const second = at(new Date(2026, 0, 5, 9), "u2");
    const third = at(new Date(2026, 0, 4, 20));
    const groups = groupActivityByDay([first, second, third]);
    expect(groups.map((group) => group.items)).toEqual([[first, second], [third]]);
    expect(groups.map((group) => group.label)).toEqual(["Jan 5, 2026", "Jan 4, 2026"]);
  });
});
