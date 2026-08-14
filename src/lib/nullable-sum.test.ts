import { describe, expect, it } from "vitest";
import { sumNullable, sumNullableBy } from "./nullable-sum";

describe("sumNullable", () => {
  it("returns null when nothing was reported", () => {
    expect(sumNullable([])).toBeNull();
    expect(sumNullable([null, undefined, null])).toBeNull();
  });

  it("keeps a genuine zero distinguishable from absence", () => {
    expect(sumNullable([0])).toBe(0);
    expect(sumNullable([0, null])).toBe(0);
  });

  it("sums only the reported values", () => {
    expect(sumNullable([1.5, null, 2.5, undefined])).toBe(4);
  });

  it("treats non-finite entries as unreported", () => {
    expect(sumNullable([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
    expect(sumNullable([Number.NaN, 3])).toBe(3);
  });
});

describe("sumNullableBy", () => {
  it("sums a nullable field across records", () => {
    const reactors = [
      { nominalThroughputTph: null },
      { nominalThroughputTph: 2 },
      { nominalThroughputTph: 3 },
    ];
    expect(sumNullableBy(reactors, (r) => r.nominalThroughputTph)).toBe(5);
  });

  it("returns null when no record reports the field", () => {
    const reactors = [{ nominalThroughputTph: null }, { nominalThroughputTph: null }];
    expect(sumNullableBy(reactors, (r) => r.nominalThroughputTph)).toBeNull();
  });
});
