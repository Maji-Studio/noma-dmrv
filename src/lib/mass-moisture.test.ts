import { describe, expect, it } from "vitest";
import {
  deriveEffectiveMoisturePercent,
  describeMassSplit,
  formatMassSplitInline,
  formatMoisturePercent,
  formatSplitMass,
  formatSummaryMass,
  formatWetDryMass,
  parseWatchedNumber,
  splitWetMassAfterAddedWater,
  splitWatchedWetMass,
  splitWetMass,
} from "./mass-moisture";

describe("formatSummaryMass", () => {
  it("shortens large KPI values to tonnes without hiding useful differences", () => {
    expect(formatSummaryMass(42_210)).toBe("42.21 t");
    expect(formatSummaryMass(41_365.8)).toBe("41.37 t");
  });

  it("keeps smaller values in kg and missing values explicit", () => {
    expect(formatSummaryMass(850.5)).toBe("850.5 kg");
    expect(formatSummaryMass(null)).toBe("Not recorded");
  });
});

describe("deriveEffectiveMoisturePercent", () => {
  it("keeps base dry matter fixed when added water increases sellable wet mass", () => {
    const effectiveMoisturePercent =
      deriveEffectiveMoisturePercent(100, 10, 50);

    expect(effectiveMoisturePercent).toBe(40);
    expect(splitWetMass(150, effectiveMoisturePercent)?.dryKg).toBe(
      90,
    );
  });

  it("equals raw moisture when no water is added", () => {
    expect(deriveEffectiveMoisturePercent(100, 10, 0)).toBe(10);
  });

  it("stays unknown when base moisture or blended mass is unresolved", () => {
    expect(deriveEffectiveMoisturePercent(100, null, 50)).toBeNull();
    expect(deriveEffectiveMoisturePercent(0, 10, 0)).toBeNull();
  });
});

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

describe("splitWetMassAfterAddedWater", () => {
  it("keeps dry matter fixed while updating final wet mass and moisture", () => {
    const split = splitWetMassAfterAddedWater(1500, 2, 30);

    expect(split).toMatchObject({
      wetKg: 1530,
      dryKg: 1470,
      waterKg: 60,
    });
    expect(split?.moisturePercent).toBeCloseTo(3.9215686);
  });

  it("rejects invalid added water and preserves the base split at zero", () => {
    expect(splitWetMassAfterAddedWater(1500, 2, -1)).toBeNull();
    expect(splitWetMassAfterAddedWater(1500, 2, Number.NaN)).toBeNull();
    expect(splitWetMassAfterAddedWater(1500, 2, 0)).toEqual(
      splitWetMass(1500, 2),
    );
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
    expect(formatMoisturePercent(null)).toBe("Not recorded");
    expect(formatMoisturePercent(undefined)).toBe("Not recorded");
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
    expect(formatMassSplitInline(split)).toBe(
      "Wet: 500 kg · Dry: 437.5 kg",
    );
  });
});

describe("formatWetDryMass", () => {
  it("keeps both mass bases explicit", () => {
    expect(formatWetDryMass({ wetKg: 850, dryKg: 820 })).toBe(
      "Wet: 850 kg · Dry: 820 kg",
    );
  });

  it("shows a missing value instead of hiding that mass basis", () => {
    expect(formatWetDryMass({ wetKg: 850, dryKg: null })).toBe(
      "Wet: 850 kg · Dry: Not recorded",
    );
  });

  it("uses authoritative dry mass before an optional derivation", () => {
    expect(
      formatWetDryMass({
        wetKg: 1_000,
        dryKg: 810,
        moisturePercent: 20,
        deriveDryWhenMissing: true,
      }),
    ).toBe("Wet: 1,000 kg · Dry: 810 kg");
  });

  it("can derive dry mass when moisture is authoritative", () => {
    expect(
      formatWetDryMass({
        wetKg: 1_000,
        dryKg: null,
        moisturePercent: 20,
        deriveDryWhenMissing: true,
      }),
    ).toBe("Wet: 1,000 kg · Dry: 800 kg");
  });

  it("supports material labels, a pipe divider, and compact kg spacing", () => {
    expect(
      formatWetDryMass({
        wetKg: 3_500,
        dryKg: 2_975,
        wetLabel: "Wet biochar product",
        dryLabel: "Dry biochar",
        separator: " | ",
        unitSpacing: "compact",
      }),
    ).toBe(
      "Wet biochar product: 3,500kg | Dry biochar: 2,975kg",
    );
  });
});
