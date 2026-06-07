import { describe, expect, it } from "vitest";
import {
  CO2_C_MOLAR_RATIO,
  F_DURABLE_MAX,
  SOIL_STORAGE_MODULE_VERSION,
  SOIL_TEMPERATURE_FLOOR_C,
  computeApplicationCo2eStored,
  computeCo2eStoredTonnes,
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

describe("drift locks against the certified v1.2 module", () => {
  it("uses the isotope-weighted 44.01/12.01 ratio, NOT the textbook 44/12", () => {
    expect(CO2_C_MOLAR_RATIO).toBeCloseTo(3.66445, 5);
    expect(CO2_C_MOLAR_RATIO).not.toBe(44 / 12);
  });

  it("is pinned to the storage module patch version recorded in versions.json", () => {
    expect(SOIL_STORAGE_MODULE_VERSION).toBe("1.2.0");
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
