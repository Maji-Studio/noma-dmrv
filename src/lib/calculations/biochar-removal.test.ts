import { describe, expect, it } from "vitest";
import {
  CO2_C_MOLAR_RATIO,
  F_DURABLE_1000_CAP,
  F_DURABLE_MAX,
  PINNED_SOIL_STORAGE_MODULE_VERSION,
  SOIL_STORAGE_MODULE_VERSION,
  SOIL_STORAGE_PREVIEW_REVERIFIED,
  SOIL_TEMPERATURE_FLOOR_C,
  computeApplicationCo2eStored,
  computeCo2eStoredTonnes,
  computeFDurable1000,
  computeFDurable200,
  resolveOrganicCarbonPercent,
} from "./biochar-removal";

// Inputs lifted from seed-data.ts (AP-26-001) + its production-run sample,
// so this worked example mirrors a real traceability chain.
const AP_101 = {
  dryMassTonnes: 1.79, // applications.biocharAppliedDryTons
  soilTemperatureC: 24.5, // applications.soilTemperatureC
  hToCorgRatio: 0.27, // samples.hToCOrgRatio
  organicCarbonPercent: 78.3, // samples.organicCarbonPercent (= 79.2 total − 0.9 inorganic)
  totalCarbonPercent: 79.2,
  inorganicCarbonPercent: 0.9,
};

describe("legacy-preview drift locks pending v1.1 re-verification", () => {
  it("uses the isotope-weighted 44.01/12.01 ratio, NOT the textbook 44/12", () => {
    expect(CO2_C_MOLAR_RATIO).toBeCloseTo(3.66445, 5);
    expect(CO2_C_MOLAR_RATIO).not.toBe(44 / 12);
  });

  it("keeps the legacy source explicit and fails closed against the current pin", () => {
    expect(SOIL_STORAGE_MODULE_VERSION).toBe("1.2.0");
    expect(PINNED_SOIL_STORAGE_MODULE_VERSION).toBe("1.1.0");
    expect(SOIL_STORAGE_PREVIEW_REVERIFIED).toBe(false);
  });

  it("caps the 1000-year durable fraction at the SAME 0.95 ceiling as the 200-year path", () => {
    expect(F_DURABLE_1000_CAP).toBe(F_DURABLE_MAX);
    expect(F_DURABLE_1000_CAP).toBe(0.95);
  });
});

describe("computeFDurable200 (Eq.3)", () => {
  it("matches the hand-worked AP-26-001 durability", () => {
    const r = computeFDurable200({ soilTemperatureC: 24.5, hToCorgRatio: 0.27 });
    expect(r.fDurable).toBeCloseTo(0.84914, 4);
    expect(r.temperatureFloored).toBe(false);
    expect(r.durabilityCapped).toBe(false);
  });

  it("applies the 7 °C conservative floor below freezing-risk temperatures", () => {
    const r = computeFDurable200({ soilTemperatureC: 5, hToCorgRatio: 0.5 });
    expect(r.effectiveSoilTemperatureC).toBe(SOIL_TEMPERATURE_FLOOR_C);
    expect(r.temperatureFloored).toBe(true);
    expect(r.fDurable).toBeCloseTo(0.89897, 4);
  });

  it("caps highly-carbonized biochar (low H/C_org) at 0.95", () => {
    const r = computeFDurable200({ soilTemperatureC: 24.5, hToCorgRatio: 0.05 });
    expect(r.fDurable).toBe(F_DURABLE_MAX);
    expect(r.durabilityCapped).toBe(true);
  });
});

describe("resolveOrganicCarbonPercent (Eq.2)", () => {
  it("prefers the reported value and confirms it reconciles with Total − Inorganic", () => {
    const r = resolveOrganicCarbonPercent(AP_101);
    expect(r.value).toBe(78.3);
    expect(r.source).toBe("reported");
    expect(r.warnings).toHaveLength(0);
  });

  it("derives organic carbon from Total − Inorganic when not reported", () => {
    const r = resolveOrganicCarbonPercent({ totalCarbonPercent: 79.2, inorganicCarbonPercent: 0.9 });
    expect(r.value).toBeCloseTo(78.3, 5);
    expect(r.source).toBe("derived");
  });

  it("warns when reported organic carbon disagrees with Total − Inorganic (drift guard)", () => {
    const r = resolveOrganicCarbonPercent({
      organicCarbonPercent: 78.3,
      totalCarbonPercent: 75,
      inorganicCarbonPercent: 0.9,
    });
    expect(r.value).toBe(78.3);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/mismatch/i);
  });
});

describe("computeCo2eStoredTonnes (Eq.1)", () => {
  it("multiplies carbon fraction × dry mass × F_durable × molar ratio", () => {
    const tonnes = computeCo2eStoredTonnes({
      organicCarbonPercent: 78.3,
      dryMassTonnes: 1.79,
      fDurable: 0.84914,
    });
    expect(tonnes).toBeCloseTo(4.362, 2);
  });
});

describe("computeApplicationCo2eStored (Eq.2 → Eq.3 → Eq.1)", () => {
  it("produces a principled value for AP-26-001", () => {
    const r = computeApplicationCo2eStored(AP_101);
    expect(r.co2eStoredTonnes).toBeCloseTo(4.362, 2);
    expect(r.fDurable).toBeCloseTo(0.84914, 4);
    expect(r.missingInputs).toHaveLength(0);
    expect(r.moduleVersion).toBe("1.2.0");
    // The seed hard-coded 3.2 t — an arbitrary placeholder, ~26% below the
    // protocol value. This is exactly the gap the calc replaces.
    expect(r.co2eStoredTonnes).not.toBeCloseTo(3.2, 1);
  });

  it("returns null with a precise gap list when an input is missing", () => {
    const r = computeApplicationCo2eStored({ ...AP_101, hToCorgRatio: null });
    expect(r.co2eStoredTonnes).toBeNull();
    expect(r.missingInputs).toContain("hToCorgRatio");
  });
});

// REPRESENTATIVE inputs only — NOT validated against real petrography/TGA lab
// data (no facility runs either assay yet), and the Eq.6 R₀-term semantics are
// unconfirmed with Isometric (see docs/open-questions.md, 2026-07-03 entry).
// These lock OUR documented normalization, not protocol ground truth.
const BATCH_1000 = {
  meanRandomReflectancePercent: 1.6, // R̄₀ (%)
  stdRandomReflectance: 0.4, // s_R₀ (percentage points)
  meanNonReactiveCarbonPercent: 62, // C̄_non-reactive (%)
  stdNonReactiveCarbonPercent: 4, // s_C_non-reactive (percentage points)
};

describe("computeFDurable1000 (Eq.6)", () => {
  it("matches the documented normalization on a representative example", () => {
    // (1.6 − 0.4) × (62 − 4)/100 = 1.2 × 0.58 = 0.696
    const r = computeFDurable1000(BATCH_1000);
    expect(r.fDurable).toBeCloseTo(0.696, 5);
    expect(r.durabilityCapped).toBe(false);
  });

  it("floors at 0 when the R₀ std-dev exceeds the mean (mandatory max(0, …))", () => {
    const r = computeFDurable1000({
      ...BATCH_1000,
      meanRandomReflectancePercent: 0.2,
      stdRandomReflectance: 0.5,
    });
    expect(r.fDurable).toBe(0);
    expect(r.durabilityCapped).toBe(false);
  });

  it("floors at 0 when BOTH terms are negative (sign cancellation must not bypass the floor)", () => {
    // (0.2 − 0.5) × (3 − 10)/100 = (−0.3) × (−0.07) = +0.021 without per-factor clamping
    const r = computeFDurable1000({
      meanRandomReflectancePercent: 0.2,
      stdRandomReflectance: 0.5,
      meanNonReactiveCarbonPercent: 3,
      stdNonReactiveCarbonPercent: 10,
    });
    expect(r.fDurable).toBe(0);
    expect(r.durabilityCapped).toBe(false);
  });

  it("caps at 0.95 for Table-3-magnitude reflectance values (mandatory min(0.95, …))", () => {
    // (2.8 − 0.3) × (68 − 2)/100 = 2.5 × 0.66 = 1.65 → capped
    const r = computeFDurable1000({
      meanRandomReflectancePercent: 2.8,
      stdRandomReflectance: 0.3,
      meanNonReactiveCarbonPercent: 68,
      stdNonReactiveCarbonPercent: 2,
    });
    expect(r.fDurable).toBe(F_DURABLE_1000_CAP);
    expect(r.durabilityCapped).toBe(true);
  });
});

describe("computeApplicationCo2eStored — 1000-year path (Eq.2 → Eq.6 → Eq.1)", () => {
  const APP_1000 = {
    durabilityOption: "1000_year" as const,
    dryMassTonnes: 1.79,
    organicCarbonPercent: 78.3,
    ...BATCH_1000,
  };

  it("routes through Eq.6 without requiring soil temperature or H/C_org", () => {
    const r = computeApplicationCo2eStored(APP_1000);
    expect(r.fDurable).toBeCloseTo(0.696, 5);
    expect(r.co2eStoredTonnes).toBeCloseTo(
      0.783 * 1.79 * 0.696 * CO2_C_MOLAR_RATIO,
      5,
    );
    expect(r.missingInputs).toHaveLength(0);
    expect(r.moduleVersion).toBe(SOIL_STORAGE_MODULE_VERSION);
    // Eq.6 has no T_soil term — the temperature fields are inert.
    expect(r.effectiveSoilTemperatureC).toBeNull();
    expect(r.temperatureFloored).toBe(false);
  });

  it("returns null with a precise gap list when a petrography/TGA input is absent", () => {
    const r = computeApplicationCo2eStored({
      ...APP_1000,
      stdRandomReflectance: null,
    });
    expect(r.co2eStoredTonnes).toBeNull();
    expect(r.fDurable).toBeNull();
    expect(r.missingInputs).toContain("stdRandomReflectance");
    // 200-year-only inputs must NOT be demanded on the 1000-year path.
    expect(r.missingInputs).not.toContain("soilTemperatureC");
    expect(r.missingInputs).not.toContain("hToCorgRatio");
  });
});
