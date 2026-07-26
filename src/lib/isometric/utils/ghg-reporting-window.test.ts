import { describe, expect, it } from "vitest";
import {
  derivePeriodStart,
  isRemovalInWindow,
  isSettledPeriodEnd,
  liveOverlapEnd,
  overlappingEnd,
  partitionByWindow,
} from "./ghg-reporting-window";

describe("derivePeriodStart", () => {
  it("anchors the first statement to null (project start)", () => {
    expect(derivePeriodStart("2026-03-31", [])).toBeNull();
  });

  it("starts the day after the latest prior end", () => {
    expect(
      derivePeriodStart("2026-06-30", ["2026-03-31", "2025-12-31"]),
    ).toBe("2026-04-01");
  });

  it("ignores ends on or after the chosen end when picking the prior", () => {
    // A later existing end must not be treated as the prior period.
    expect(
      derivePeriodStart("2026-06-30", ["2026-03-31", "2026-09-30"]),
    ).toBe("2026-04-01");
  });

  it("ignores an equal end (idempotent re-pick of an existing period)", () => {
    expect(derivePeriodStart("2026-03-31", ["2026-03-31"])).toBeNull();
  });

  it("crosses a month boundary correctly", () => {
    expect(derivePeriodStart("2026-05-15", ["2026-01-31"])).toBe("2026-02-01");
  });
});

describe("overlappingEnd", () => {
  it("returns null when the end is clear of every other period", () => {
    expect(overlappingEnd("2026-06-30", ["2026-03-31"])).toBeNull();
  });

  it("flags an end on or before another statement's end", () => {
    expect(overlappingEnd("2026-03-31", ["2026-06-30"])).toBe("2026-06-30");
    expect(overlappingEnd("2026-05-01", ["2026-06-30"])).toBe("2026-06-30");
  });

  it("excludes the own-end so an idempotent re-pick is not flagged", () => {
    expect(overlappingEnd("2026-06-30", ["2026-06-30"])).toBeNull();
  });

  it("compares against the latest other end", () => {
    expect(
      overlappingEnd("2026-04-15", ["2026-01-31", "2026-06-30"]),
    ).toBe("2026-06-30");
  });
});

describe("isSettledPeriodEnd", () => {
  it("accepts a fully typed period end", () => {
    expect(isSettledPeriodEnd("2028-01-31")).toBe(true);
    expect(isSettledPeriodEnd("1000-01-01")).toBe(true);
  });

  it("rejects the values a date input emits while the year is typed", () => {
    // Chrome fires a change per keystroke of the year segment: 2 → 20 → 202 →
    // 2028. Each intermediate is a well-formed date that sorts before every
    // real period end.
    expect(isSettledPeriodEnd("0002-01-31")).toBe(false);
    expect(isSettledPeriodEnd("0020-01-31")).toBe(false);
    expect(isSettledPeriodEnd("0202-01-31")).toBe(false);
  });

  it("rejects an empty or malformed value", () => {
    expect(isSettledPeriodEnd("")).toBe(false);
    expect(isSettledPeriodEnd("2028-1-31")).toBe(false);
    expect(isSettledPeriodEnd("2028-01-31T00:00:00Z")).toBe(false);
  });
});

describe("liveOverlapEnd", () => {
  const existingEnds = ["2027-12-31", "2027-09-30"];

  it("flags a genuine overlap", () => {
    expect(liveOverlapEnd("2027-06-30", existingEnds)).toBe("2027-12-31");
  });

  it("clears itself once the date is edited past the overlap", () => {
    // The dialog derives this on every render from the watched value, so the
    // second call is what the operator sees the instant they fix the date —
    // no second Next click needed (QA 2026-07-25).
    expect(liveOverlapEnd("2027-06-30", existingEnds)).toBe("2027-12-31");
    expect(liveOverlapEnd("2028-01-31", existingEnds)).toBeNull();
  });

  it("stays silent while the year is still being typed", () => {
    expect(liveOverlapEnd("0002-01-31", existingEnds)).toBeNull();
    expect(liveOverlapEnd("0020-01-31", existingEnds)).toBeNull();
    expect(liveOverlapEnd("0202-01-31", existingEnds)).toBeNull();
    // …and reports the truth as soon as the year is complete.
    expect(liveOverlapEnd("2028-01-31", existingEnds)).toBeNull();
    expect(liveOverlapEnd("2020-01-31", existingEnds)).toBe("2027-12-31");
  });

  it("stays silent for an empty field", () => {
    expect(liveOverlapEnd("", existingEnds)).toBeNull();
  });

  it("finds no overlap against an empty list", () => {
    expect(liveOverlapEnd("2028-01-31", [])).toBeNull();
  });
});

describe("isRemovalInWindow", () => {
  it("excludes a removal with no completion date", () => {
    expect(isRemovalInWindow(null, "2026-01-01", "2026-06-30")).toBe(false);
  });

  it("includes a removal inside a bounded window (inclusive both ends)", () => {
    expect(isRemovalInWindow("2026-01-01", "2026-01-01", "2026-06-30")).toBe(
      true,
    );
    expect(isRemovalInWindow("2026-06-30", "2026-01-01", "2026-06-30")).toBe(
      true,
    );
    expect(isRemovalInWindow("2026-03-15", "2026-01-01", "2026-06-30")).toBe(
      true,
    );
  });

  it("excludes a removal after the end", () => {
    expect(isRemovalInWindow("2026-07-01", "2026-01-01", "2026-06-30")).toBe(
      false,
    );
  });

  it("excludes a removal before the derived start", () => {
    expect(isRemovalInWindow("2025-12-31", "2026-01-01", "2026-06-30")).toBe(
      false,
    );
  });

  it("applies no lower bound for the first statement (null start)", () => {
    expect(isRemovalInWindow("2020-01-01", null, "2026-06-30")).toBe(true);
    expect(isRemovalInWindow("2026-07-01", null, "2026-06-30")).toBe(false);
  });
});

describe("partitionByWindow", () => {
  const removals = [
    { id: "a", completedOn: "2026-02-01" }, // in
    { id: "b", completedOn: "2025-12-01" }, // before start
    { id: "c", completedOn: null }, // no date
    { id: "d", completedOn: "2026-06-30" }, // in (end inclusive)
    { id: "e", completedOn: "2026-07-15" }, // after end
  ];

  it("splits removals by window and preserves order within buckets", () => {
    const { inPeriod, outside } = partitionByWindow(
      removals,
      "2026-01-01",
      "2026-06-30",
    );
    expect(inPeriod.map((r) => r.id)).toEqual(["a", "d"]);
    expect(outside.map((r) => r.id)).toEqual(["b", "c", "e"]);
  });

  it("puts everything up to the end in-period when start is null", () => {
    const { inPeriod, outside } = partitionByWindow(
      removals,
      null,
      "2026-06-30",
    );
    expect(inPeriod.map((r) => r.id)).toEqual(["a", "b", "d"]);
    expect(outside.map((r) => r.id)).toEqual(["c", "e"]);
  });

  it("returns an empty in-period bucket when nothing falls inside", () => {
    const { inPeriod, outside } = partitionByWindow(
      [{ id: "z", completedOn: "2027-01-01" }],
      "2026-01-01",
      "2026-06-30",
    );
    expect(inPeriod).toEqual([]);
    expect(outside.map((r) => r.id)).toEqual(["z"]);
  });
});
