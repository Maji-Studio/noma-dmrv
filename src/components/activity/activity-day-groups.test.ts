import { describe, expect, it } from "vitest";
import { activityDayLabel, groupActivityByDay } from "./activity-day-groups";
import type { ActivityItem } from "./activity-display";

const at = (value: Date, actor = "u1") => ({ id: `${value.toISOString()}${actor}`, occurredAt: value, actor: { id: actor }, source: "form" }) as ActivityItem;

const TIME_ZONE = "Africa/Dar_es_Salaam";
const NOW = new Date("2026-10-21T22:00:00Z");

describe("activity day groups", () => {
  it("labels facility today and yesterday across browser midnight", () => {
    const today = at(new Date("2026-10-21T21:30:00Z"));
    const yesterday = at(new Date("2026-10-21T18:50:00Z"));
    const groups = groupActivityByDay([today, yesterday], TIME_ZONE, NOW);
    expect(groups.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "2026-10-22", label: "Today" },
      { key: "2026-10-21", label: "Yesterday" },
    ]);
    expect(activityDayLabel(new Date("2026-01-05T21:30:00Z"), TIME_ZONE, NOW)).toBe("Jan 6, 2026");
  });

  it("groups consecutive items of one facility day and keeps the order", () => {
    const first = at(new Date("2026-01-05T15:00:00Z"));
    const second = at(new Date("2026-01-05T09:00:00Z"), "u2");
    const third = at(new Date("2026-01-04T20:00:00Z"));
    const groups = groupActivityByDay([first, second, third], TIME_ZONE, NOW);
    expect(groups.map((group) => group.items)).toEqual([[first, second], [third]]);
    expect(groups.map((group) => group.label)).toEqual(["Jan 5, 2026", "Jan 4, 2026"]);
  });
});
