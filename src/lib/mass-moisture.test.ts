import { describe, expect, it } from "vitest";
import {
  describeMassSplit,
  formatMassSplitInline,
  formatMoisturePercent,
  formatSplitMass,
  parseWatchedNumber,
  splitWatchedWetMass,
  splitWetMass,
} from "./mass-moisture";

describe("splitWetMass", () => {
  it("splits a wet mass into dry matter and water on a wet basis", () => {
    const split = splitWetMass(1000, 20);
    expect(split).toMatchObject({ wetKg: 1000, dryKg: 800, waterKg: 200, dryFraction: 0.8 });
  });

  it("treats 0% moisture as entirely dry and 100% as entirely water", () => {
    expect(splitWetMass(500, 0)).toMatchObject({ dryKg: 500, waterKg: 0, dryFraction: 1 });
    expect(splitWetMass(500, 100)).toMatchObject({ dryKg: 0, waterKg: 500, dryFraction: 0 });
  });

  it("returns null rather than a bogus split when either input is missing", () => {
    expect(splitWetMass(null, 20)).toBeNull();
    expect(splitWetMass(1000, null)).toBeNull();
    expect(splitWetMass(undefined, undefined)).toBeNull();
  });

  it("returns null for out-of-range inputs so the caller shows the unresolved state", () => {
    expect(splitWetMass(-1, 20)).toBeNull();
    expect(splitWetMass(1000, -0.1)).toBeNull();
    expect(splitWetMass(1000, 100.1)).toBeNull();
    expect(splitWetMass(Number.NaN, 20)).toBeNull();
    expect(splitWetMass(1000, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("never reports water as negative when rounding nudges dry above wet", () => {
    const split = splitWetMass(0.001, 0);
    expect(split?.waterKg).toBe(0);
  });

  it("calls a zero wet mass fully dry rather than dividing by zero", () => {
    expect(splitWetMass(0, 50)).toMatchObject({ dryKg: 0, waterKg: 0, dryFraction: 1 });
  });
});

describe("parseWatchedNumber", () => {
  it("accepts finite numbers and numeric strings mid-edit", () => {
    expect(parseWatchedNumber(12.5)).toBe(12.5);
    expect(parseWatchedNumber("12.5")).toBe(12.5);
  });

  it("rejects the values Number() would silently turn into 0", () => {
    expect(parseWatchedNumber(null)).toBeNull();
    expect(parseWatchedNumber(undefined)).toBeNull();
    expect(parseWatchedNumber("")).toBeNull();
    expect(parseWatchedNumber("   ")).toBeNull();
    expect(parseWatchedNumber("abc")).toBeNull();
    expect(parseWatchedNumber(Number.NaN)).toBeNull();
  });

  it("splits watched string values the same as numeric ones", () => {
    expect(splitWatchedWetMass("1000", "20")).toMatchObject({ dryKg: 800, waterKg: 200 });
    expect(splitWatchedWetMass("", "20")).toBeNull();
  });
});

describe("formatMoisturePercent", () => {
  it("shows one decimal and trims a trailing zero", () => {
    expect(formatMoisturePercent(20)).toBe("20%");
    expect(formatMoisturePercent(20.46)).toBe("20.5%");
    expect(formatMoisturePercent(1.5)).toBe("1.5%");
  });

  it("falls back to the shared em-dash for missing readings", () => {
    expect(formatMoisturePercent(null)).toBe("—");
    expect(formatMoisturePercent(undefined)).toBe("—");
  });
});

describe("formatSplitMass", () => {
  it("stays in kg so a small water fraction cannot round away", () => {
    // In tonnes both of these read "1.5 t" and the split claims no water.
    expect(formatSplitMass(1500)).toBe("1,500 kg");
    expect(formatSplitMass(1470)).toBe("1,470 kg");
    expect(formatSplitMass(30)).toBe("30 kg");
  });
});

describe("split descriptions", () => {
  it("spells the split out for screen readers", () => {
    const split = splitWetMass(1000, 20)!;
    expect(describeMassSplit(split)).toBe(
      "1,000 kg wet: 800 kg dry mass and 200 kg water at 20% moisture."
    );
  });

  it("summarises a split on one line", () => {
    const split = splitWetMass(500, 12.5)!;
    expect(formatMassSplitInline(split)).toBe("437.5 kg dry · 12.5% moisture");
  });
});
