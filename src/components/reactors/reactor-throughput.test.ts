import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatTotalThroughputTph } from "./reactor-throughput";

describe("formatTotalThroughputTph", () => {
  it("renders the missing-value token, without a unit, when nothing is recorded", () => {
    const value = formatTotalThroughputTph([
      { nominalThroughputTph: null },
      { nominalThroughputTph: null },
    ]);

    expect(value).toBe(MISSING_VALUE.notRecorded);
    expect(value).not.toContain("tph");
    expect(value).not.toContain("0");
  });

  it("renders the token for an empty page rather than a fabricated zero", () => {
    expect(formatTotalThroughputTph([])).toBe(MISSING_VALUE.notRecorded);
  });

  it("sums the reactors that do report a throughput", () => {
    expect(
      formatTotalThroughputTph([
        { nominalThroughputTph: 1.5 },
        { nominalThroughputTph: null },
        { nominalThroughputTph: 2.5 },
      ]),
    ).toBe("4 tph");
  });

  it("still reports a real measured zero", () => {
    expect(formatTotalThroughputTph([{ nominalThroughputTph: 0 }])).toBe("0 tph");
  });
});
