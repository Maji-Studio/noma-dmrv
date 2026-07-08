import { describe, expect, it } from "vitest";
import {
  derivePeriodStart,
  isRemovalInWindow,
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
