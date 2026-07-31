import { describe, expect, it } from "vitest";
import {
  formatDayString,
  formatFacilityDateTimeWithOffset,
  formatMass,
  formatPercent,
} from "./format-utils";

describe("formatFacilityDateTimeWithOffset", () => {
  it("formats facility-local time with its numeric UTC offset", () => {
    expect(
      formatFacilityDateTimeWithOffset(
        new Date("2026-07-31T12:34:00.000Z"),
        "Europe/Zurich",
      ),
    ).toBe("2026-07-31 14:34 +02:00");
  });
});

describe("formatDayString", () => {
  it("formats a YYYY-MM-DD day without reparsing into an instant", () => {
    expect(formatDayString("2026-08-01")).toBe("Aug 1, 2026");
    expect(formatDayString("2026-12-25")).toBe("Dec 25, 2026");
  });

  it("returns the fallback for null, undefined, or malformed input", () => {
    expect(formatDayString(null)).toBe("Not recorded");
    expect(formatDayString(undefined)).toBe("Not recorded");
    expect(formatDayString("")).toBe("Not recorded");
    expect(formatDayString("2026-08-01T12:00:00Z")).toBe("Not available");
    expect(formatDayString("2026-13-01")).toBe("Not available");
  });
});

describe("formatMass", () => {
  it("rounds kilograms and converts larger masses to tonnes", () => {
    expect(formatMass(999.6)).toBe("1,000 kg");
    expect(formatMass(1_250)).toBe("1.3 t");
  });

  it("returns the fallback for null, undefined, and NaN", () => {
    expect(formatMass(null)).toBe("Not recorded");
    expect(formatMass(undefined)).toBe("Not recorded");
    expect(formatMass(Number.NaN)).toBe("Not recorded");
  });
});

describe("formatPercent", () => {
  it("preserves requested lab precision", () => {
    expect(formatPercent(1.96, { digits: 2 })).toBe("1.96%");
  });
});
