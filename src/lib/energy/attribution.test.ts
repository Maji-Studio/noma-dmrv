import { describe, expect, it } from "vitest";
import { buildEnergyBreakdown } from "./attribution";
import { sumSourceAmounts } from "./sources";
import type {
  EnergyFactors,
  EnergyInputs,
  EnergyRecord,
  EnergyRunInput,
} from "./types";

const FACTORS: EnergyFactors = {
  dieselKgCo2ePerLitre: 2.68,
  gridKgCo2ePerKwh: 0.5,
  roadFreightKgCo2ePerTonneKm: 0.1,
};
const ALL_TIME = { from: null, to: "2026-09-30" };

function run(overrides: Partial<EnergyRunInput> & { id: string }): EnergyRunInput {
  return {
    code: overrides.id.toUpperCase(),
    day: "2026-09-10",
    reactorName: "Reactor 1",
    creditBatchId: null,
    dieselOperationLiters: 10,
    dieselGensetLiters: 20,
    preprocessingFuelLiters: 5,
    electricityKwh: 100,
    lowCarbonPercentage: null,
    biocharDryMassKg: 900,
    ...overrides,
  };
}

function inputs(overrides: Partial<EnergyInputs> = {}): EnergyInputs {
  return {
    runs: [],
    feedstocks: [],
    feedstockDraws: [],
    deliveries: [],
    deliveryRunShares: [],
    applications: [],
    applicationRunShares: [],
    creditBatches: [],
    ...overrides,
  };
}

function record(records: EnergyRecord[], id: string): EnergyRecord {
  const found = records.find((r) => r.id === id);
  if (!found) throw new Error(`no record ${id}`);
  return found;
}

const sumFlows = (breakdown: ReturnType<typeof buildEnergyBreakdown>, source: string) =>
  breakdown.flows
    .filter((flow) => flow.source === source)
    .reduce((total, flow) => total + flow.activity, 0);

describe("buildEnergyBreakdown", () => {
  it("keeps a null reading as a missing reading, never zero", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({ runs: [run({ id: "a", electricityKwh: null })] }),
      FACTORS,
      ALL_TIME,
    );
    const a = record(breakdown.records, "a");
    expect(a.footprint.gaps.grid).toEqual({ missing: 1, of: 1, unit: "run" });
    expect(a.footprint.activity.grid).toBe(0);
    expect(breakdown.flows.some((flow) => flow.source === "grid")).toBe(false);
    expect(breakdown.gaps).toEqual([
      { source: "grid", creditBatchIds: [], day: "2026-09-10", recordId: "a" },
    ]);
  });

  it("estimates diesel and takes the low-carbon share off grid electricity", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({ runs: [run({ id: "a", lowCarbonPercentage: 40 })] }),
      FACTORS,
      ALL_TIME,
    );
    const { kg, activity } = record(breakdown.records, "a").footprint;
    expect(activity.grid).toBe(100);
    expect(kg?.grid).toBeCloseTo(100 * 0.5 * 0.6);
    expect(kg?.startup).toBeCloseTo(10 * 2.68);
    expect(kg?.genset).toBeCloseTo(20 * 2.68);
    expect(kg?.preprocessing).toBeCloseTo(5 * 2.68);
  });

  it("counts every transport leg as a round trip", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        runs: [run({ id: "a" })],
        feedstocks: [
          { id: "f", code: "FS-1", day: "2026-09-01", wetMassKg: 2000, legs: [{ distanceKm: 10, loadMassKg: 2000 }] },
        ],
        feedstockDraws: [{ runId: "a", feedstockId: "f", wetMassKg: 2000 }],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: "Farm", effectiveDistanceKm: 25, deliveredWetMassKg: 1000, massDryKg: 450 },
        ],
      }),
      FACTORS,
      ALL_TIME,
    );
    expect(record(breakdown.records, "a").footprint.activity.feedstockTransport).toBeCloseTo(40);
    expect(record(breakdown.records, "d").footprint.activity.biocharTransport).toBeCloseTo(50);
    expect(record(breakdown.records, "d").footprint.kg?.biocharTransport).toBeCloseTo(5);
  });

  it("splits feedstock and delivery transport so the parts add up to the source totals", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        creditBatches: [
          { id: "b1", code: "CB-1", startDate: "2026-09-01", endDate: "2026-09-30", status: "pending" },
          { id: "b2", code: "CB-2", startDate: "2026-09-01", endDate: "2026-09-30", status: "pending" },
        ],
        runs: [run({ id: "a", creditBatchId: "b1" }), run({ id: "b", creditBatchId: "b2", biocharDryMassKg: 600 })],
        feedstocks: [
          { id: "f", code: "FS-1", day: "2026-09-01", wetMassKg: 3000, legs: [{ distanceKm: 15, loadMassKg: 3000 }] },
        ],
        // 1,000 kg stays in the bin and reaches no credit batch.
        feedstockDraws: [
          { runId: "a", feedstockId: "f", wetMassKg: 1500 },
          { runId: "b", feedstockId: "f", wetMassKg: 500 },
        ],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: "Farm", effectiveDistanceKm: 20, deliveredWetMassKg: 1000, massDryKg: 900 },
        ],
        deliveryRunShares: [
          { ownerId: "d", runId: "a", dryMassKg: 450 },
          { ownerId: "d", runId: "b", dryMassKg: 450 },
        ],
      }),
      FACTORS,
      ALL_TIME,
    );
    const feedstockTonneKm = 2 * 15 * 3;
    expect(sumFlows(breakdown, "feedstockTransport")).toBeCloseTo(feedstockTonneKm);
    const unassigned = breakdown.flows.find(
      (flow) => flow.source === "feedstockTransport" && flow.creditBatchId == null,
    );
    expect(unassigned?.activity).toBeCloseTo(feedstockTonneKm / 3);
    expect(sumFlows(breakdown, "biocharTransport")).toBeCloseTo(2 * 20 * 1);

    const b1 = record(breakdown.records, "b1");
    const b2 = record(breakdown.records, "b2");
    expect(b1.footprint.activity.biocharTransport + b2.footprint.activity.biocharTransport).toBeCloseTo(40);
    expect(b1.footprint.activity.feedstockTransport).toBeCloseTo(feedstockTonneKm / 2);
    expect(b2.footprint.activity.feedstockTransport).toBeCloseTo(feedstockTonneKm / 6);
  });

  it("gives a delivery the production energy of the dry biochar it carried", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        runs: [run({ id: "a", biocharDryMassKg: 900 })],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: "Farm", effectiveDistanceKm: 20, deliveredWetMassKg: 500, massDryKg: 450 },
        ],
        deliveryRunShares: [{ ownerId: "d", runId: "a", dryMassKg: 450 }],
      }),
      FACTORS,
      ALL_TIME,
    );
    const d = record(breakdown.records, "d");
    expect(d.footprint.activity.startup).toBeCloseTo(5);
    expect(d.footprint.activity.grid).toBeCloseTo(50);
    expect(d.runCount).toBe(1);
    expect(d.dryMassKg).toBe(450);
  });

  it("marks a carried run without dry output as missing instead of guessing a share", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        runs: [run({ id: "a", biocharDryMassKg: null })],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: null, effectiveDistanceKm: 20, deliveredWetMassKg: 500, massDryKg: 450 },
        ],
        deliveryRunShares: [{ ownerId: "d", runId: "a", dryMassKg: 450 }],
      }),
      FACTORS,
      ALL_TIME,
    );
    const d = record(breakdown.records, "d");
    expect(d.footprint.gaps.startup).toEqual({ missing: 1, of: 1, unit: "run" });
    expect(d.footprint.activity.startup).toBe(0);
  });

  it("shares production and transport with an application by dry mass", () => {
    const base = inputs({
      creditBatches: [{ id: "b1", code: "CB-1", startDate: "2026-09-01", endDate: "2026-09-30", status: "pending" }],
      runs: [run({ id: "a", creditBatchId: "b1", biocharDryMassKg: 900 })],
      deliveries: [
        { id: "d", code: "DL-1", day: "2026-09-20", customerName: "Farm", effectiveDistanceKm: 20, deliveredWetMassKg: 1000, massDryKg: 900 },
      ],
      deliveryRunShares: [{ ownerId: "d", runId: "a", dryMassKg: 900 }],
      applications: [{ id: "p", code: "AP-1", day: "2026-09-25", deliveryId: "d", dryMassKg: 300, fieldName: "North block" }],
    });

    const withShares = buildEnergyBreakdown(
      { ...base, applicationRunShares: [{ ownerId: "p", runId: "a", dryMassKg: 300 }] },
      FACTORS,
      ALL_TIME,
    );
    const fromDelivery = buildEnergyBreakdown(base, FACTORS, ALL_TIME);
    for (const breakdown of [withShares, fromDelivery]) {
      const p = record(breakdown.records, "p");
      expect(p.footprint.activity.genset).toBeCloseTo(20 / 3);
      expect(p.footprint.activity.biocharTransport).toBeCloseTo(40 / 3);
      expect(p.creditBatchIds).toEqual(["b1"]);
      expect(p.context).toBe("North block");
    }
  });

  it("counts production as missing for an application with no dry mass to scale by", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        creditBatches: [{ id: "b1", code: "CB-1", startDate: "2026-09-01", endDate: "2026-09-30", status: "pending" }],
        runs: [run({ id: "a", creditBatchId: "b1", biocharDryMassKg: 900 })],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: "Farm", effectiveDistanceKm: 20, deliveredWetMassKg: 1000, massDryKg: 900 },
        ],
        deliveryRunShares: [{ ownerId: "d", runId: "a", dryMassKg: 900 }],
        applications: [{ id: "p", code: "AP-1", day: "2026-09-25", deliveryId: "d", dryMassKg: null, fieldName: null }],
      }),
      FACTORS,
      ALL_TIME,
    );
    const p = record(breakdown.records, "p");
    for (const source of ["startup", "genset", "preprocessing", "grid", "biocharTransport"] as const) {
      expect(p.footprint.activity[source]).toBe(0);
      expect(p.footprint.gaps[source]).toMatchObject({ missing: 1, of: 1 });
    }
    expect(p.creditBatchIds).toEqual(["b1"]);
    expect(p.runCount).toBe(1);
  });

  it("returns activity without estimates when the facility has no factors", () => {
    const breakdown = buildEnergyBreakdown(inputs({ runs: [run({ id: "a" })] }), null, ALL_TIME);
    const a = record(breakdown.records, "a");
    expect(a.footprint.kg).toBeNull();
    expect(sumSourceAmounts(a.footprint.activity)).toBeCloseTo(135);
    expect(breakdown.flows.every((flow) => flow.kg == null)).toBe(true);
    expect(breakdown.factors).toBeNull();
  });

  it("keeps records, flows and production inside the period", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        creditBatches: [
          { id: "old", code: "CB-OLD", startDate: "2026-07-01", endDate: "2026-07-31", status: "pending" },
          { id: "now", code: "CB-NOW", startDate: "2026-08-25", endDate: "2026-09-24", status: "pending" },
        ],
        runs: [
          run({ id: "a", day: "2026-07-10", creditBatchId: "old" }),
          run({ id: "b", day: "2026-09-10", creditBatchId: "now" }),
        ],
      }),
      FACTORS,
      { from: "2026-09-01", to: "2026-09-30" },
    );
    expect(breakdown.records.map((r) => r.id).sort()).toEqual(["b", "now"]);
    expect(new Set(breakdown.flows.map((flow) => flow.day))).toEqual(new Set(["2026-09-10"]));
    expect(breakdown.production).toEqual([{ creditBatchId: "now", dryMassKg: 900 }]);
    expect(breakdown.from).toBe("2026-09-01");
  });

  it("starts all time at the first recorded day", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({ runs: [run({ id: "a", day: "2025-03-02" }), run({ id: "b", day: "2026-01-01" })] }),
      FACTORS,
      ALL_TIME,
    );
    expect(breakdown.from).toBe("2025-03-02");
  });
});
