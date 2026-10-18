import { describe, expect, it } from "vitest";
import {
  dayPercentOfYear,
  defaultNewBatchWindow,
  deriveTimelineState,
  groupByFeedstock,
  monthWindow,
  newBatchSlots,
  placeOnYear,
  proposeWindow,
  timelineYears,
} from "./timeline";

describe("proposeWindow", () => {
  it("ends a gap window at the end of the month", () => {
    expect(proposeWindow("2026-02-14", "2026-03-10")).toEqual({ start: "2026-02-15", end: "2026-02-28" });
  });
  it("ends at the day before the next batch when that comes first", () => {
    expect(proposeWindow("2026-06-20", "2026-07-01")).toEqual({ start: "2026-06-21", end: "2026-06-30" });
    expect(proposeWindow("2026-03-01", "2026-03-10")).toEqual({ start: "2026-03-02", end: "2026-03-09" });
  });
  it("gives no window when no whole day is free", () => {
    expect(proposeWindow("2026-06-30", "2026-07-01")).toBeNull();
  });
  it("takes the rest of the month after the last batch", () => {
    expect(proposeWindow("2026-10-19", null)).toEqual({ start: "2026-10-20", end: "2026-10-31" });
  });
  it("takes the whole next month when the last batch ended on a month end", () => {
    expect(proposeWindow("2026-09-30", null)).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(proposeWindow("2026-12-31", null)).toEqual({ start: "2027-01-01", end: "2027-01-31" });
  });
});

describe("newBatchSlots", () => {
  it("fills a gap month by month, then the rest of the month after the last batch", () => {
    const slots = newBatchSlots(
      [
        { start: "2026-05-10", end: "2026-06-09" },
        { start: "2026-07-20", end: "2026-08-19" },
      ],
      "2026-10-16",
    );
    expect(slots.map((slot) => [slot.start, slot.end])).toEqual([
      ["2026-06-10", "2026-06-30"],
      ["2026-07-01", "2026-07-19"],
      ["2026-08-20", "2026-08-31"],
    ]);
  });
  it("sorts unordered input", () => {
    const slots = newBatchSlots(
      [
        { start: "2026-03-01", end: "2026-03-31" },
        { start: "2026-01-01", end: "2026-01-31" },
      ],
      "2026-10-16",
    );
    expect(slots[0]).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("offers the current month on an empty row", () => {
    expect(newBatchSlots([], "2026-10-16")).toEqual([{ start: "2026-10-01", end: "2026-10-31" }]);
  });
});

describe("monthWindow", () => {
  it("covers the whole calendar month, leap years included", () => {
    expect(monthWindow("2028-02-10")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
});

describe("defaultNewBatchWindow", () => {
  it("is the current month when it is free", () => {
    expect(defaultNewBatchWindow([{ start: "2026-08-01", end: "2026-09-30" }], "2026-10-16")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });
  it("skips a partly used month to the next free whole month", () => {
    expect(defaultNewBatchWindow([{ start: "2026-09-20", end: "2026-10-19" }], "2026-10-16")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });
  it("skips several taken months and crosses the year end", () => {
    expect(defaultNewBatchWindow([{ start: "2026-10-01", end: "2026-12-31" }], "2026-10-16")).toEqual({ start: "2027-01-01", end: "2027-01-31" });
  });
});

describe("placeOnYear", () => {
  it("places a window as percentages of the year", () => {
    const spot = placeOnYear({ start: "2026-01-01", end: "2026-12-31" }, 2026);
    expect(spot).toMatchObject({ left: 0, cutStart: false, cutEnd: false });
    expect(spot?.width).toBeCloseTo(100);
  });
  it("cuts a window that crosses the year end and drops one outside", () => {
    expect(placeOnYear({ start: "2025-12-15", end: "2026-01-14" }, 2026)).toMatchObject({ left: 0, cutStart: true, cutEnd: false });
    expect(placeOnYear({ start: "2025-12-15", end: "2026-01-14" }, 2025)).toMatchObject({ cutStart: false, cutEnd: true });
    expect(placeOnYear({ start: "2025-12-15", end: "2026-01-14" }, 2027)).toBeNull();
  });
  it("puts a day on the year track", () => {
    expect(dayPercentOfYear("2026-07-02")).toBeCloseTo(50, 0);
  });
});

describe("timelineYears", () => {
  it("covers batch years and today, without holes", () => {
    expect(timelineYears([{ start: "2024-11-01", end: "2024-11-30" }], "2026-10-16")).toEqual([2024, 2025, 2026]);
  });
  it("reaches the next year when a batch ends on Dec 31 and its trailing slot falls in January", () => {
    const batches = [{ start: "2026-12-01", end: "2026-12-31" }];
    expect(timelineYears(batches, "2026-12-10")).toEqual([2026]);
    expect(timelineYears([...batches, ...newBatchSlots(batches, "2026-12-10")], "2026-12-10")).toEqual([2026, 2027]);
  });
  it("is just this year without batches", () => {
    expect(timelineYears([], "2026-10-16")).toEqual([2026]);
  });
});

describe("deriveTimelineState", () => {
  const base = { lifecycleFailed: false, healthState: "ready" as const, blockingCount: 0 };
  it("is unknown until readiness loads", () => {
    expect(deriveTimelineState(null)).toBeNull();
  });
  it("is blocking when readiness has unmet checks", () => {
    expect(deriveTimelineState({ ...base, lifecycleStepIndex: 0, healthState: "incomplete", blockingCount: 2 })).toBe("blocking");
  });
  it("is ready with nothing blocking", () => {
    expect(deriveTimelineState({ ...base, lifecycleStepIndex: 0 })).toBe("ready");
  });
  it("is submitted once a Removal is submitted, even with open items", () => {
    expect(deriveTimelineState({ ...base, lifecycleStepIndex: 1, healthState: "incomplete", blockingCount: 1 })).toBe("submitted");
  });
  it("is issued when credits are issued", () => {
    expect(deriveTimelineState({ ...base, lifecycleStepIndex: 3 })).toBe("issued");
  });
  it("needs work when verification failed, even with no missing data", () => {
    expect(deriveTimelineState({ ...base, lifecycleStepIndex: 2, lifecycleFailed: true })).toBe("blocking");
  });
  it("keeps the data readiness for a rejected or interrupted Removal", () => {
    expect(deriveTimelineState({ ...base, lifecycleStepIndex: 0, lifecycleFailed: true })).toBe("ready");
    expect(deriveTimelineState({ ...base, lifecycleStepIndex: 0, lifecycleFailed: true, healthState: "incomplete", blockingCount: 1 })).toBe("blocking");
  });
});

describe("groupByFeedstock", () => {
  it("makes one row per feedstock, by name, with batches in start order", () => {
    const rows = groupByFeedstock(
      [
        { id: "a", start: "2026-02-01", end: "2026-02-28", feedstockTypeId: "f2", feedstockTypeName: "Maize cobs" },
        { id: "b", start: "2026-01-01", end: "2026-01-31", feedstockTypeId: "f1", feedstockTypeName: "Forestry waste" },
        { id: "c", start: "2026-01-01", end: "2026-01-31", feedstockTypeId: "f2", feedstockTypeName: null },
      ],
      "Feedstock not set",
    );
    expect(rows.map((row) => [row.feedstockTypeId, row.feedstockName])).toEqual([
      ["f1", "Forestry waste"],
      ["f2", "Maize cobs"],
    ]);
    expect(rows[1].batches.map((batch) => batch.id)).toEqual(["c", "a"]);
  });
});
