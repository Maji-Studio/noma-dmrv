import { describe, expect, it } from "vitest";
import { activityDayLabel, collapseRepeatedActivity, groupActivityByDay } from "./activity-day-groups";
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

describe("collapsing repeated activity", () => {
  const event = (id: string, overrides: Partial<ActivityItem> = {}) => ({
    id, action: "updated", entityType: "emission_entry", entityId: "entry-1", changedFields: ["sendReservedBySubmissionId"],
    changes: {}, fromStatus: null, toStatus: null, fromRemote: null, toRemote: null, source: "form", reasonCode: null,
    occurredAt: new Date("2026-01-05T15:00:00Z"), actor: { id: "u1", name: "Ada" },
    record: { label: "Emissions entry", deleted: false, facilityId: "f1", facilityTimezone: null }, ...overrides,
  }) as unknown as ActivityItem;

  it("folds consecutive identical rows into the newest with a count", () => {
    const runs = collapseRepeatedActivity(Array.from({ length: 10 }, (_, i) => event(`e${i}`)), TIME_ZONE);
    expect(runs).toHaveLength(1);
    expect(runs[0].item.id).toBe("e0");
    expect(runs[0].count).toBe(10);
    expect(runs[0].ids).toHaveLength(10);
  });

  it("treats a change to hidden bookkeeping fields as the same row as another one", () => {
    const runs = collapseRepeatedActivity([event("a", { changedFields: ["checksumSha256"] }), event("b", { changedFields: ["uploadStatus"] })], TIME_ZONE);
    expect(runs.map((run) => run.count)).toEqual([2]);
  });

  it("keeps rows apart when the actor, record, action or shown change differs, or they are not adjacent", () => {
    const runs = collapseRepeatedActivity([
      event("a"),
      event("b", { actor: { id: "u2", name: "Bo" } }),
      event("c", { entityId: "entry-2" }),
      event("d", { action: "deleted" }),
      event("e", { changedFields: ["note"] }),
      event("f"),
    ], TIME_ZONE);
    expect(runs.map((run) => run.count)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});
