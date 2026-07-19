import { afterEach, describe, expect, it } from "vitest";
import {
  formatCo2e,
  formatDate,
  formatDateRange,
  formatDateTime,
} from "@/lib/format-utils";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("formatDate", () => {
  it("formats date-only strings as calendar dates without UTC drift", () => {
    process.env.TZ = "America/Los_Angeles";

    expect(formatDate("2026-06-13")).toBe("Jun 13, 2026");
  });

  it("formats ISO strings and Date inputs", () => {
    process.env.TZ = "UTC";

    expect(formatDate("2026-06-13T10:30:00.000Z")).toBe("Jun 13, 2026");
    expect(formatDate(new Date("2026-06-13T10:30:00.000Z"))).toBe(
      "Jun 13, 2026",
    );
  });

  it("returns a dash for null and invalid dates", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("2026-02-31")).toBe("—");
    expect(formatDate(new Date(Number.NaN))).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("uses the canonical date and a 24-hour time", () => {
    process.env.TZ = "UTC";

    expect(formatDateTime("2026-06-13T14:05:00.000Z")).toBe(
      "Jun 13, 2026, 14:05",
    );
    expect(formatDateTime(new Date("2026-06-13T23:05:00.000Z"))).toBe(
      "Jun 13, 2026, 23:05",
    );
  });

  it("returns a dash for null and invalid values", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});

describe("formatDateRange", () => {
  it("compacts ranges within the same year", () => {
    expect(formatDateRange("2026-06-01", "2026-06-30")).toBe(
      "Jun 1 – Jun 30, 2026",
    );
  });

  it("shows both years for cross-year ranges", () => {
    expect(formatDateRange("2026-12-15", "2027-01-10")).toBe(
      "Dec 15, 2026 – Jan 10, 2027",
    );
  });

  it("accepts Date inputs and rejects incomplete or invalid ranges", () => {
    expect(
      formatDateRange(new Date(2026, 5, 1), new Date(2026, 5, 30)),
    ).toBe("Jun 1 – Jun 30, 2026");
    expect(formatDateRange(null, "2026-06-30")).toBe("—");
    expect(formatDateRange("2026-06-01", "invalid")).toBe("—");
  });
});

describe("formatCo2e", () => {
  it("returns a dash for null, undefined, and NaN", () => {
    expect(formatCo2e(null)).toBe("—");
    expect(formatCo2e(undefined)).toBe("—");
    expect(formatCo2e(Number.NaN)).toBe("—");
  });

  it("renders whole kg below one tonne and tonnes at or above it", () => {
    expect(formatCo2e(950)).toBe("950 kg CO₂e");
    expect(formatCo2e(1000)).toBe("1 t CO₂e");
    expect(formatCo2e(1040)).toBe("1.04 t CO₂e");
  });

  it("renders a value that rounds to zero as an unsigned zero", () => {
    expect(formatCo2e(0.4)).toBe("0 kg CO₂e");
    // The whole point of rounding before signing: never a misleading "+0"/"−0".
    expect(formatCo2e(0.4, { signed: true })).toBe("0 kg CO₂e");
    expect(formatCo2e(-0.4, { signed: true })).toBe("0 kg CO₂e");
  });

  it("prepends a sign only when requested and the magnitude is non-zero", () => {
    expect(formatCo2e(15, { signed: true })).toBe("+15 kg CO₂e");
    expect(formatCo2e(-15, { signed: true })).toBe("−15 kg CO₂e");
    expect(formatCo2e(15)).toBe("15 kg CO₂e");
  });

  it("drops the unit suffix when given an empty unit", () => {
    expect(formatCo2e(15, { unit: "" })).toBe("15");
  });
});
