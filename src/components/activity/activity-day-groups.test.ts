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
    const groups = groupActivityByDay([
      at(new Date(2026, 0, 5, 15)), at(new Date(2026, 0, 5, 9)), at(new Date(2026, 0, 4, 20)),
    ]);
    expect(groups.map((group) => group.clusters.flatMap((cluster) => cluster.items).length)).toEqual([2, 1]);
    expect(groups.map((group) => group.label)).toEqual(["Jan 5, 2026", "Jan 4, 2026"]);
  });

  it("clusters a burst by one actor and splits on another actor or a gap", () => {
    const [group] = groupActivityByDay([
      at(new Date(2026, 0, 5, 15, 41, 30)), at(new Date(2026, 0, 5, 15, 41, 5)), at(new Date(2026, 0, 5, 15, 41, 1), "u2"),
      at(new Date(2026, 0, 5, 15, 30)),
    ]);
    expect(group.clusters.map((cluster) => cluster.items.length)).toEqual([2, 1, 1]);
  });

  it("joins at exactly the window and splits just past it", () => {
    const head = new Date(2026, 0, 5, 15, 41, 0);
    const [joined] = groupActivityByDay([at(head), at(new Date(head.getTime() - 60_000))]);
    expect(joined.clusters.map((cluster) => cluster.items.length)).toEqual([2]);
    const [split] = groupActivityByDay([at(head), at(new Date(head.getTime() - 61_000))]);
    expect(split.clusters.map((cluster) => cluster.items.length)).toEqual([1, 1]);
  });

  it("measures the window from the burst head, so a steady stream does not chain", () => {
    const head = new Date(2026, 0, 5, 15, 41, 0);
    const [group] = groupActivityByDay([
      at(head), at(new Date(head.getTime() - 40_000)), at(new Date(head.getTime() - 80_000)),
    ]);
    expect(group.clusters.map((cluster) => cluster.items.length)).toEqual([2, 1]);
  });
});
