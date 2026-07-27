import { describe, expect, it } from "vitest";
import { formatDayString, formatMass, formatPercent } from "./format-utils";

describe("formatDayString", () => {
  it("formats a YYYY-MM-DD day without reparsing into an instant", () => {
    expect(formatDayString("2026-08-01")).toBe("Aug 1, 2026");
    expect(formatDayString("2026-12-25")).toBe("Dec 25, 2026");
  });

  it("returns the fallback for null, undefined, or malformed input", () => {
    expect(formatDayString(null)).toBe("—");
    expect(formatDayString(undefined)).toBe("—");
    expect(formatDayString("")).toBe("—");
    expect(formatDayString("2026-08-01T12:00:00Z")).toBe("—");
    expect(formatDayString("2026-13-01")).toBe("—");
  });
});

describe("formatMass", () => {
  it("returns the fallback for null, undefined, and NaN", () => {
    expect(formatMass(null)).toBe("—");
    expect(formatMass(undefined)).toBe("—");
    expect(formatMass(Number.NaN)).toBe("—");
  });
});

describe("formatPercent", () => {
  it("preserves requested lab precision", () => {
    expect(formatPercent(1.96, { digits: 2 })).toBe("1.96%");
  });
});
