import { describe, expect, it } from "vitest";
import { MISSING_VALUE } from "./copy-utils";
import {
  formatCo2e,
  formatDayString,
  formatDistanceKm,
  formatFacilityDateTimeWithOffset,
  formatFileSize,
  formatMass,
  formatMassKg,
  formatPercent,
  formatTonnes,
} from "./format-utils";

describe("missing-value routing", () => {
  // The rule: a formatter that receives a value an operator records returns
  // "Not recorded" for null; one that receives a value the app derives returns
  // "Not available". See the vocabulary in ./copy-utils.
  it.each([
    ["formatMass", formatMass],
    ["formatMassKg", formatMassKg],
    ["formatPercent", formatPercent],
    ["formatDistanceKm", formatDistanceKm],
  ])("%s reports a recorded quantity as not recorded", (_name, format) => {
    expect(format(null)).toBe(MISSING_VALUE.notRecorded);
    expect(format(undefined)).toBe(MISSING_VALUE.notRecorded);
  });

  it.each([
    ["formatCo2e", formatCo2e],
    ["formatTonnes", formatTonnes],
    ["formatFileSize", formatFileSize],
  ])("%s reports a derived quantity as not available", (_name, format) => {
    expect(format(null)).toBe(MISSING_VALUE.notAvailable);
    expect(format(undefined)).toBe(MISSING_VALUE.notAvailable);
  });

  it("still formats a measured zero rather than a placeholder", () => {
    expect(formatMass(0)).toBe("0 kg");
    expect(formatDistanceKm(0)).toBe("0 km");
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("formatFacilityDateTimeWithOffset", () => {
  it("formats facility-local time with its numeric UTC offset", () => {
    expect(
      formatFacilityDateTimeWithOffset(
        new Date("2026-07-31T12:34:00.000Z"),
        "Europe/Zurich",
      ),
    ).toBe("2026-07-31 14:34 +02:00");

    expect(
      formatFacilityDateTimeWithOffset(
        new Date("2026-07-31T12:34:00.000Z"),
        "UTC",
      ),
    ).toBe("2026-07-31 12:34 +00:00");
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

describe("formatCo2e", () => {
  it("keeps kilograms whole below a tonne and gives tonnes three decimals", () => {
    expect(formatCo2e(15.4)).toBe("15 kg CO₂e");
    expect(formatCo2e(3_704)).toBe("3.704 t CO₂e");
  });

  it("returns the shared missing marker for null and undefined", () => {
    expect(formatCo2e(null)).toBe("Not available");
    expect(formatCo2e(undefined)).toBe("Not available");
  });

  it("signs from the displayed magnitude so a rounded zero stays unsigned", () => {
    expect(formatCo2e(1_040, { signed: true })).toBe("+1.04 t CO₂e");
    expect(formatCo2e(-15.4, { signed: true })).toBe("−15 kg CO₂e");
    expect(formatCo2e(0.4, { signed: true })).toBe("0 kg CO₂e");
  });
});

describe("formatPercent", () => {
  it("preserves requested lab precision", () => {
    expect(formatPercent(1.96, { digits: 2 })).toBe("1.96%");
  });
});
