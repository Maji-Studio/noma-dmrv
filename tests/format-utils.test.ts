import { afterEach, describe, expect, it } from "vitest";
import { formatCo2e, formatSafeDate } from "@/lib/format-utils";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("formatSafeDate", () => {
  it("formats date-only strings as calendar dates without UTC drift", () => {
    process.env.TZ = "America/Los_Angeles";

    expect(formatSafeDate("2026-06-13")).toBe("Jun 13, 2026");
  });

  it("keeps timestamp formatting safe", () => {
    expect(formatSafeDate("2026-06-13T10:30:00.000Z", "yyyy-MM-dd")).toBe(
      "2026-06-13",
    );
  });

  it("returns a dash for invalid dates", () => {
    expect(formatSafeDate("2026-02-31")).toBe("—");
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
