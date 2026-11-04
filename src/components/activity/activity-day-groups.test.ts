import { describe, expect, it } from "vitest";
import { activityDayLabel, collapseRepeatedActivity, countActivityRows, describePageLoad, groupActivityByDay } from "./activity-day-groups";
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
    id, action: "updated", entityType: "emission_entry", entityId: "entry-1", changedFields: ["note"],
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

  it("keeps rows apart when the actor, record, action or shown change differs, or they are not adjacent", () => {
    const runs = collapseRepeatedActivity([
      event("a"),
      event("b", { actor: { id: "u2", name: "Bo" } }),
      event("c", { entityId: "entry-2" }),
      event("d", { action: "deleted" }),
      event("e", { changedFields: ["siteNotes"] }),
      event("f"),
    ], TIME_ZONE);
    expect(runs.map((run) => run.count)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("keeps a form edit and an API edit by the same person apart", () => {
    const runs = collapseRepeatedActivity([event("a"), event("b", { source: "rest" })], TIME_ZONE);
    expect(runs.map((run) => run.count)).toEqual([1, 1]);
  });

  it("leaves out an update that touched only internal fields", () => {
    const runs = collapseRepeatedActivity(Array.from({ length: 10 }, (_, i) => event(`h${i}`, { changedFields: ["sendReservedBySubmissionId"] })).concat(event("note")), TIME_ZONE);
    expect(runs.map((run) => run.item.id)).toEqual(["note"]);
    expect(countActivityRows([event("h", { changedFields: ["checksumSha256"] })], TIME_ZONE)).toBe(0);
  });

  it("counts rows, not events, so a page of repeats adds no row", () => {
    const page = Array.from({ length: 5 }, (_, i) => event(`n${i}`));
    expect(countActivityRows(page, TIME_ZONE)).toBe(1);
    expect(countActivityRows([...page, event("other", { entityId: "entry-2" })], TIME_ZONE)).toBe(2);
  });

  describe("describePageLoad", () => {
    const hidden = (id: string) => event(id, { changedFields: ["checksumSha256"] });

    it("focuses the row of the first newly loaded visible event, found by id", () => {
      const before = [event("a", { entityId: "x" })];
      const after = [...before, hidden("h"), event("b", { entityId: "y" }), event("c", { entityId: "z" })];
      expect(describePageLoad(before, after, TIME_ZONE)).toMatchObject({ addedRows: 2, grew: false, focusId: "b", lastId: "c" });
    });

    it("reports a grown row when only older repeats load, and focuses it", () => {
      const before = [event("a"), event("b")];
      const after = [...before, event("c")];
      expect(describePageLoad(before, after, TIME_ZONE)).toMatchObject({ addedRows: 0, grew: true, focusId: "a", lastId: "a" });
    });

    it("finds nothing to focus when the page added only hidden updates", () => {
      const before = [event("a")];
      const after = [...before, hidden("h1"), hidden("h2")];
      expect(describePageLoad(before, after, TIME_ZONE)).toEqual({ addedRows: 0, grew: false, focusId: null, lastId: "a" });
    });
  });
});
