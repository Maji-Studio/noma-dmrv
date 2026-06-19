import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import {
  buildPerBatchDurabilityData,
  buildSoilTemperatureReconciliationWarnings,
  reconcileDeclaredHToCorg,
  resolveConservativeSoilTemperature,
  resolveFacilityReferenceSoilTemperature,
  type CreditBatchDurabilityInput,
  type FacilityReferenceSoilTemperature,
} from "./durability-aggregation";

function sample(overrides: Partial<Sample>): Sample {
  return {
    hToCOrgRatio: null,
    oToCOrgRatio: null,
    totalCarbonPercent: null,
    organicCarbonPercent: null,
    inorganicCarbonPercent: null,
    ...overrides,
  } as unknown as Sample;
}

function batch(
  creditBatchId: string,
  creditBatchCode: string,
  runs: CreditBatchDurabilityInput["runs"],
  samples: Sample[],
): CreditBatchDurabilityInput {
  return { creditBatchId, creditBatchCode, runs, samples };
}

describe("buildPerBatchDurabilityData (credit-batch grain, ADR 0015)", () => {
  it("produces one datapoint per credit batch with pooled replicate means and sample std-dev", () => {
    const b = batch(
      "batch-1",
      "CB-1",
      [{ id: "run-1", biocharDryMassKg: 1000 }],
      [
        sample({ hToCOrgRatio: 0.28, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: 1 }),
        sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 82, organicCarbonPercent: 81, inorganicCarbonPercent: 1 }),
        sample({ hToCOrgRatio: 0.32, totalCarbonPercent: 84, organicCarbonPercent: 83, inorganicCarbonPercent: 1 }),
      ],
    );
    const [dp] = buildPerBatchDurabilityData([b]);
    expect(dp.creditBatchId).toBe("batch-1");
    expect(dp.creditBatchCode).toBe("CB-1");
    expect(dp.sampled).toBe(true);
    expect(dp.replicateCount).toBe(3);
    expect(dp.hToCorgRatio?.mean).toBeCloseTo(0.3, 5);
    // sample std-dev (n-1) of [0.28,0.30,0.32] = 0.02
    expect(dp.hToCorgRatio?.stdDev).toBeCloseTo(0.02, 5);
    expect(dp.totalCarbonPercent?.mean).toBeCloseTo(82, 5);
    expect(dp.inorganicCarbonPercent?.mean).toBeCloseTo(1, 5);
    expect(dp.productMassKg).toBe(1000);
  });

  it("pools samples across the batch's member runs and sums their dry mass", () => {
    const b = batch(
      "batch-1",
      "CB-1",
      [
        { id: "run-1", biocharDryMassKg: 600 },
        { id: "run-2", biocharDryMassKg: 400 },
      ],
      [
        // drawn from run-1
        sample({ hToCOrgRatio: 0.28, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: 1 }),
        sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: 1 }),
        // drawn from run-2
        sample({ hToCOrgRatio: 0.32, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: 1 }),
      ],
    );
    const [dp] = buildPerBatchDurabilityData([b]);
    expect(dp.replicateCount).toBe(3);
    expect(dp.hToCorgRatio?.mean).toBeCloseTo(0.3, 5);
    expect(dp.productMassKg).toBe(1000);
  });

  it("derives inorganic carbon as max(0, total − organic) when the lab omits it", () => {
    const b = batch(
      "batch-1",
      "CB-1",
      [{ id: "run-1", biocharDryMassKg: 500 }],
      [
        sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 80, organicCarbonPercent: 78, inorganicCarbonPercent: null }),
        sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: null }),
      ],
    );
    const [dp] = buildPerBatchDurabilityData([b]);
    // derived inorganic per replicate: (80-78)=2, (80-79)=1 → mean 1.5
    expect(dp.inorganicCarbonPercent?.mean).toBeCloseTo(1.5, 5);
  });

  it("never derives a negative inorganic carbon (clamped at 0)", () => {
    const b = batch(
      "batch-1",
      "CB-1",
      [{ id: "run-1", biocharDryMassKg: 500 }],
      [sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 78, organicCarbonPercent: 80, inorganicCarbonPercent: null })],
    );
    const [dp] = buildPerBatchDurabilityData([b]);
    expect(dp.inorganicCarbonPercent?.mean).toBe(0);
  });

  it("marks a batch with no usable chemistry as unsampled but keeps its product mass", () => {
    const b = batch("batch-2", "CB-2", [{ id: "run-2", biocharDryMassKg: 700 }], []);
    const [dp] = buildPerBatchDurabilityData([b]);
    expect(dp.sampled).toBe(false);
    expect(dp.replicateCount).toBe(0);
    expect(dp.hToCorgRatio).toBeNull();
    expect(dp.productMassKg).toBe(700);
  });

  it("scales each member run's product mass by its attribution factor", () => {
    const b = batch(
      "batch-1",
      "CB-1",
      [
        { id: "run-1", biocharDryMassKg: 1000 },
        { id: "run-2", biocharDryMassKg: 1000 },
      ],
      [sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: 1 })],
    );
    const [dp] = buildPerBatchDurabilityData(
      [b],
      new Map([
        ["run-1", 0.4],
        ["run-2", 0.5],
      ]),
    );
    expect(dp.productMassKg).toBeCloseTo(900, 5);
  });

  it("returns null std-dev for a single replicate (no dispersion)", () => {
    const b = batch(
      "batch-1",
      "CB-1",
      [{ id: "run-1", biocharDryMassKg: 100 }],
      [sample({ hToCOrgRatio: 0.3, totalCarbonPercent: 80, organicCarbonPercent: 79, inorganicCarbonPercent: 1 })],
    );
    const [dp] = buildPerBatchDurabilityData([b]);
    expect(dp.hToCorgRatio?.mean).toBeCloseTo(0.3, 5);
    expect(dp.hToCorgRatio?.stdDev).toBeNull();
  });
});

describe("resolveConservativeSoilTemperature (D2 soil-temp resolution)", () => {
  it("uses the MAX site temperature (conservative worst-case, module §5)", () => {
    const r = resolveConservativeSoilTemperature([12, 18.4, 15]);
    expect(r.maxSoilTemperatureC).toBe(18.4);
    expect(r.effectiveSoilTemperatureC).toBe(18.4);
    expect(r.temperatureFloored).toBe(false);
    expect(r.conservativeEstimate).toBe(true);
    expect(r.method).toMatch(/conservative/i);
  });

  it("raises a subdivide warning when sites span more than 1 °C", () => {
    const r = resolveConservativeSoilTemperature([10, 14]);
    expect(r.spreadC).toBeCloseTo(4, 5);
    expect(r.subdivideWarning).toBe(true);
    expect(r.warnings.some((w) => /subdiv/i.test(w))).toBe(true);
  });

  it("does not warn when sites are within 1 °C", () => {
    const r = resolveConservativeSoilTemperature([12.0, 12.6]);
    expect(r.subdivideWarning).toBe(false);
  });

  it("applies the 7 °C floor to a cold conservative max", () => {
    const r = resolveConservativeSoilTemperature([3, 5]);
    expect(r.maxSoilTemperatureC).toBe(5);
    expect(r.effectiveSoilTemperatureC).toBe(7);
    expect(r.temperatureFloored).toBe(true);
  });

  it("returns null and a warning when no site has a soil temperature", () => {
    const r = resolveConservativeSoilTemperature([null, undefined]);
    expect(r.effectiveSoilTemperatureC).toBeNull();
    expect(r.maxSoilTemperatureC).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("reconcileDeclaredHToCorg (D5a divergence guard)", () => {
  it("returns no warning when declared matches aggregated within tolerance", () => {
    expect(reconcileDeclaredHToCorg(0.3, 0.305)).toBeNull();
  });

  it("warns when declared diverges beyond tolerance", () => {
    const w = reconcileDeclaredHToCorg(0.3, 0.45);
    expect(w).not.toBeNull();
    expect(w).toMatch(/0\.3/);
  });

  it("returns no warning when either value is missing", () => {
    expect(reconcileDeclaredHToCorg(null, 0.3)).toBeNull();
    expect(reconcileDeclaredHToCorg(0.3, null)).toBeNull();
  });
});

describe("resolveFacilityReferenceSoilTemperature (Phase 2 facility reference)", () => {
  it("rounds the declared value to one decimal and carries the source", () => {
    const r = resolveFacilityReferenceSoilTemperature({
      declaredSoilTemperatureC: 24.249,
      source: "Lembrechts 2022",
    });
    expect(r).not.toBeNull();
    expect(r!.declaredSoilTemperatureC).toBe(24.2);
    expect(r!.effectiveSoilTemperatureC).toBe(24.2);
    expect(r!.temperatureFloored).toBe(false);
    expect(r!.source).toBe("Lembrechts 2022");
    expect(r!.method).toMatch(/Lembrechts 2022/);
    expect(r!.warnings).toEqual([]);
  });

  it("applies the 7 °C floor to a cold declared value and warns", () => {
    const r = resolveFacilityReferenceSoilTemperature({
      declaredSoilTemperatureC: 4.3,
      source: null,
    });
    expect(r!.declaredSoilTemperatureC).toBe(4.3);
    expect(r!.effectiveSoilTemperatureC).toBe(7);
    expect(r!.temperatureFloored).toBe(true);
    expect(r!.warnings.some((w) => /floor/i.test(w))).toBe(true);
  });

  it("normalizes a blank source to null", () => {
    const r = resolveFacilityReferenceSoilTemperature({
      declaredSoilTemperatureC: 12,
      source: "   ",
    });
    expect(r!.source).toBeNull();
  });

  it("returns null when no value is declared", () => {
    expect(
      resolveFacilityReferenceSoilTemperature({
        declaredSoilTemperatureC: null,
        source: "anything",
      }),
    ).toBeNull();
    expect(
      resolveFacilityReferenceSoilTemperature({
        declaredSoilTemperatureC: undefined,
        source: null,
      }),
    ).toBeNull();
  });
});

describe("buildSoilTemperatureReconciliationWarnings (conservative-direction check)", () => {
  const reference: FacilityReferenceSoilTemperature = {
    declaredSoilTemperatureC: 20,
    effectiveSoilTemperatureC: 20,
    source: null,
    temperatureFloored: false,
    method: "ref",
    warnings: [],
  };

  it("warns when a site is WARMER than the reference (would over-credit)", () => {
    const w = buildSoilTemperatureReconciliationWarnings({
      facilityReference: reference,
      applicationSoilTemperaturesC: [18, 22.5, 19],
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/22\.5/);
    expect(w[0]).toMatch(/over-credit/i);
  });

  it("does not warn when every site is at or below the reference", () => {
    expect(
      buildSoilTemperatureReconciliationWarnings({
        facilityReference: reference,
        applicationSoilTemperaturesC: [20, 15, 19.9],
      }),
    ).toEqual([]);
  });

  it("ignores missing site temperatures", () => {
    expect(
      buildSoilTemperatureReconciliationWarnings({
        facilityReference: reference,
        applicationSoilTemperaturesC: [null, undefined],
      }),
    ).toEqual([]);
  });
});
