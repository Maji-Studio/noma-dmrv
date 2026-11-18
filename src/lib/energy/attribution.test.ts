import { describe, expect, it } from "vitest";
import { buildEnergyBreakdown } from "./attribution";
import type { EnergyFeedstockInput, EnergyInputs, EnergyRecord, EnergyRunInput } from "./types";

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
    biocharDryMassKg: 900,
    ...overrides,
  };
}

function inputs(overrides: Partial<EnergyInputs> = {}): EnergyInputs {
  return {
    runs: [],
    feedstocks: [],
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

/** Feb drew 60% and Mar 40%; the loader resolves Feb as the sole owner. */
function sharedFeedstockInputs(): EnergyInputs {
  return inputs({
    creditBatches: [
      { id: "feb-batch", code: "CB-FEB", startDate: "2026-02-01", endDate: "2026-02-28" },
      { id: "mar-batch", code: "CB-MAR", startDate: "2026-03-01", endDate: "2026-03-31" },
    ],
    runs: [
      run({ id: "feb", day: "2026-02-10", creditBatchId: "feb-batch", biocharDryMassKg: 900 }),
      run({ id: "mar", day: "2026-03-10", creditBatchId: "mar-batch", biocharDryMassKg: 600 }),
    ],
    feedstocks: [{
      id: "f", code: "FS-1", day: "2026-01-10", transportOwnerRunId: "feb",
      legs: [{ distanceKm: 500, loadMassKg: 1000, method: "road" }],
    }],
  });
}

describe("buildEnergyBreakdown", () => {
  it("keeps a null reading as a missing reading, never zero", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({ runs: [run({ id: "a", electricityKwh: null })] }),
      ALL_TIME,
    );
    const a = record(breakdown.records, "a");
    expect(a.footprint.gaps.grid).toEqual({ missing: 1, of: 1, unit: "run", recorded: false });
    expect(a.footprint.activity.grid).toBe(0);
    expect(breakdown.flows.some((flow) => flow.source === "grid")).toBe(false);
    expect(breakdown.gaps).toEqual([
      { source: "grid", creditBatchIds: [], day: "2026-09-10", recordId: "a" },
    ]);
  });

  it("reports recorded diesel and grid electricity in their own units, with no CO2e", () => {
    const breakdown = buildEnergyBreakdown(inputs({ runs: [run({ id: "a" })] }), ALL_TIME);
    const { footprint } = record(breakdown.records, "a");
    expect(footprint.activity).toMatchObject({
      startup: 10,
      genset: 20,
      preprocessing: 5,
      grid: 100,
    });
    expect(footprint).not.toHaveProperty("kg");
    expect(breakdown.flows.every((flow) => !("kg" in flow))).toBe(true);
  });

  it("counts every transport leg as a round trip", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        runs: [run({ id: "a" })],
        feedstocks: [
          { id: "f", code: "FS-1", day: "2026-09-01", transportOwnerRunId: "a", legs: [{ distanceKm: 10, loadMassKg: 2000, method: "road" }] },
        ],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: "Farm", effectiveDistanceKm: 25, deliveredWetMassKg: 1000, massDryKg: 450 },
        ],
      }),
      ALL_TIME,
    );
    expect(record(breakdown.records, "a").footprint.activity.feedstockTransport).toBeCloseTo(40);
    expect(record(breakdown.records, "d").footprint.activity.biocharTransport).toBeCloseTo(50);
  });

  it("counts a feedstock with a non-road leg as missing instead of counting it as road tonne-km", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        runs: [run({ id: "a" })],
        feedstocks: [
          {
            id: "f",
            code: "FS-1",
            day: "2026-09-01",
            transportOwnerRunId: "a",
            legs: [
              { distanceKm: 10, loadMassKg: 2000, method: "road" },
              { distanceKm: 300, loadMassKg: 2000, method: "rail" },
            ],
          },
        ],
      }),
      ALL_TIME,
    );
    const a = record(breakdown.records, "a").footprint;
    expect(a.activity.feedstockTransport).toBe(0);
    expect(a.gaps.feedstockTransport).toMatchObject({ missing: 1, of: 1, unit: "feedstock" });
    expect(breakdown.flows.some((flow) => flow.source === "feedstockTransport")).toBe(false);
  });

  it("counts feedstock transport once and splits delivery transport so parts add up to totals", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        creditBatches: [
          { id: "b1", code: "CB-1", startDate: "2026-09-01", endDate: "2026-09-30" },
          { id: "b2", code: "CB-2", startDate: "2026-09-01", endDate: "2026-09-30" },
        ],
        runs: [run({ id: "a", creditBatchId: "b1" }), run({ id: "b", creditBatchId: "b2", biocharDryMassKg: 600 })],
        feedstocks: [
          { id: "f", code: "FS-1", day: "2026-09-01", transportOwnerRunId: "a", legs: [{ distanceKm: 15, loadMassKg: 3000, method: "road" }] },
        ],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: "Farm", effectiveDistanceKm: 20, deliveredWetMassKg: 1000, massDryKg: 900 },
        ],
        deliveryRunShares: [
          { ownerId: "d", runId: "a", dryMassKg: 450 },
          { ownerId: "d", runId: "b", dryMassKg: 450 },
        ],
      }),
      ALL_TIME,
    );
    const feedstockTonneKm = 2 * 15 * 3;
    expect(sumFlows(breakdown, "feedstockTransport")).toBeCloseTo(feedstockTonneKm);
    const unassigned = breakdown.flows.find(
      (flow) => flow.source === "feedstockTransport" && flow.creditBatchId == null,
    );
    expect(unassigned).toBeUndefined();
    expect(sumFlows(breakdown, "biocharTransport")).toBeCloseTo(2 * 20 * 1);

    const b1 = record(breakdown.records, "b1");
    const b2 = record(breakdown.records, "b2");
    expect(b1.footprint.activity.biocharTransport + b2.footprint.activity.biocharTransport).toBeCloseTo(40);
    expect(b1.footprint.activity.feedstockTransport).toBeCloseTo(feedstockTonneKm);
    expect(b2.footprint.activity.feedstockTransport).toBe(0);
  });

  it("counts all 1,000 tonne-km on the owner of a feedstock drawn 60/40", () => {
    const breakdown = buildEnergyBreakdown(sharedFeedstockInputs(), ALL_TIME);
    for (const id of ["feb", "feb-batch"]) {
      expect(record(breakdown.records, id).footprint.activity.feedstockTransport).toBe(1000);
    }
    for (const id of ["mar", "mar-batch"]) {
      expect(record(breakdown.records, id).footprint.activity.feedstockTransport).toBe(0);
      expect(record(breakdown.records, id).footprint.gaps.feedstockTransport).toBeUndefined();
    }
    expect(breakdown.flows.filter((flow) => flow.source === "feedstockTransport")).toEqual([
      { source: "feedstockTransport", creditBatchId: "feb-batch", day: "2026-01-10", activity: 1000 },
    ]);
    expect(sumFlows(breakdown, "feedstockTransport")).toBe(1000);
  });

  it.each([null, "unloaded-owner"])("leaves transport unattributed with owner %s", (transportOwnerRunId) => {
    const base = sharedFeedstockInputs();
    base.feedstocks[0].transportOwnerRunId = transportOwnerRunId;
    const breakdown = buildEnergyBreakdown(base, ALL_TIME);
    expect(breakdown.flows.filter((flow) => flow.source === "feedstockTransport")).toEqual([
      { source: "feedstockTransport", creditBatchId: null, day: "2026-01-10", activity: 1000 },
    ]);
    for (const row of breakdown.records) {
      expect(row.footprint.activity.feedstockTransport).toBe(0);
      expect(row.footprint.gaps.feedstockTransport).toBeUndefined();
    }
  });

  it.each<{ label: string; legs: EnergyFeedstockInput["legs"] }>([
    { label: "no legs", legs: [] },
    { label: "a non-road leg", legs: [
      { distanceKm: 500, loadMassKg: 1000, method: "road" },
      { distanceKm: 500, loadMassKg: 1000, method: "rail" },
    ] },
    { label: "an unknown load", legs: [{ distanceKm: 500, loadMassKg: null, method: "road" }] },
    { label: "a zero load", legs: [{ distanceKm: 500, loadMassKg: 0, method: "road" }] },
  ])("counts a feedstock with $label as missing only on its owner", ({ legs }) => {
    const base = sharedFeedstockInputs();
    base.feedstocks[0].legs = legs;
    const breakdown = buildEnergyBreakdown(base, ALL_TIME);
    for (const id of ["feb", "feb-batch"]) {
      const footprint = record(breakdown.records, id).footprint;
      expect(footprint.activity.feedstockTransport).toBe(0);
      expect(footprint.gaps.feedstockTransport).toEqual({ missing: 1, of: 1, unit: "feedstock", recorded: false });
    }
    for (const id of ["mar", "mar-batch"]) {
      expect(record(breakdown.records, id).footprint.activity.feedstockTransport).toBe(0);
      expect(record(breakdown.records, id).footprint.gaps.feedstockTransport).toBeUndefined();
    }
    expect(breakdown.flows.filter((flow) => flow.source === "feedstockTransport")).toEqual([]);
    expect(breakdown.gaps.filter((gap) => gap.source === "feedstockTransport")).toEqual([
      { source: "feedstockTransport", creditBatchIds: ["feb-batch"], day: "2026-01-10", recordId: "f" },
    ]);
  });

  it.each([null, "unloaded-owner"])("leaves missing transport unattributed with owner %s", (transportOwnerRunId) => {
    const base = sharedFeedstockInputs();
    base.feedstocks[0] = { ...base.feedstocks[0], transportOwnerRunId, legs: [] };
    const breakdown = buildEnergyBreakdown(base, ALL_TIME);
    expect(breakdown.gaps.filter((gap) => gap.source === "feedstockTransport")).toEqual([
      { source: "feedstockTransport", creditBatchIds: [], day: "2026-01-10", recordId: "f" },
    ]);
    expect(breakdown.records.every((row) => row.footprint.gaps.feedstockTransport == null)).toBe(true);
  });

  it.each([null, "unloaded-batch"])("keeps an owner's missing transport unattributed without a loaded batch %s", (creditBatchId) => {
    const base = sharedFeedstockInputs();
    base.runs[0].creditBatchId = creditBatchId;
    base.feedstocks[0].legs = [];
    const breakdown = buildEnergyBreakdown(base, ALL_TIME);
    expect(record(breakdown.records, "feb").footprint.gaps.feedstockTransport).toMatchObject({ missing: 1, of: 1 });
    expect(breakdown.gaps.filter((gap) => gap.source === "feedstockTransport")).toEqual([
      { source: "feedstockTransport", creditBatchIds: [], day: "2026-01-10", recordId: "f" },
    ]);
  });

  it("carries the owner's whole transport by delivery dry share and none from a non-owner", () => {
    const base = sharedFeedstockInputs();
    base.deliveries = ["owner-delivery", "other-delivery"].map((id) => ({
      id, code: id, day: "2026-09-20", customerName: null,
      effectiveDistanceKm: 20, deliveredWetMassKg: 500, massDryKg: 300,
    }));
    base.deliveryRunShares = [
      { ownerId: "owner-delivery", runId: "feb", dryMassKg: 300 },
      { ownerId: "other-delivery", runId: "mar", dryMassKg: 300 },
    ];
    const breakdown = buildEnergyBreakdown(base, ALL_TIME);
    const owner = record(breakdown.records, "owner-delivery").footprint;
    const other = record(breakdown.records, "other-delivery").footprint;
    expect(owner.activity.feedstockTransport).toBeCloseTo(1000 / 3);
    expect(other.activity.feedstockTransport).toBe(0);
    expect(other.gaps.feedstockTransport).toBeUndefined();
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
        feedstocks: [
          { id: "f", code: "FS-1", day: "2026-09-01", transportOwnerRunId: "a", legs: [{ distanceKm: 10, loadMassKg: 2000, method: "road" }] },
        ],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: null, effectiveDistanceKm: 20, deliveredWetMassKg: 500, massDryKg: 450 },
        ],
        deliveryRunShares: [{ ownerId: "d", runId: "a", dryMassKg: 450 }],
      }),
      ALL_TIME,
    );
    const d = record(breakdown.records, "d");
    expect(d.footprint.gaps.startup).toEqual({ missing: 1, of: 1, unit: "run", recorded: false });
    expect(d.footprint.activity.startup).toBe(0);
    expect(d.footprint.activity.feedstockTransport).toBe(0);
    expect(d.footprint.gaps.feedstockTransport).toEqual({ missing: 1, of: 1, unit: "feedstock", recorded: false });
  });

  it("shares production and transport with an application by dry mass", () => {
    const base = inputs({
      creditBatches: [{ id: "b1", code: "CB-1", startDate: "2026-09-01", endDate: "2026-09-30" }],
      runs: [run({ id: "a", creditBatchId: "b1", biocharDryMassKg: 900 })],
      feedstocks: [
        { id: "f", code: "FS-1", day: "2026-09-01", transportOwnerRunId: "a", legs: [{ distanceKm: 10, loadMassKg: 2000, method: "road" }] },
      ],
      deliveries: [
        { id: "d", code: "DL-1", day: "2026-09-20", customerName: "Farm", effectiveDistanceKm: 20, deliveredWetMassKg: 1000, massDryKg: 900 },
      ],
      deliveryRunShares: [{ ownerId: "d", runId: "a", dryMassKg: 900 }],
      applications: [{ id: "p", code: "AP-1", day: "2026-09-25", deliveryId: "d", dryMassKg: 300, fieldName: "North block" }],
    });

    const withShares = buildEnergyBreakdown(
      { ...base, applicationRunShares: [{ ownerId: "p", runId: "a", dryMassKg: 300 }] },
      ALL_TIME,
    );
    const fromDelivery = buildEnergyBreakdown(base, ALL_TIME);
    for (const breakdown of [withShares, fromDelivery]) {
      const p = record(breakdown.records, "p");
      expect(p.footprint.activity.genset).toBeCloseTo(20 / 3);
      expect(p.footprint.activity.biocharTransport).toBeCloseTo(40 / 3);
      expect(p.footprint.activity.feedstockTransport).toBeCloseTo(40 / 3);
      expect(p.creditBatchIds).toEqual(["b1"]);
      expect(p.context).toBe("North block");
    }
  });

  it("keeps the owner's recorded transport when a non-owner carried run cannot be scaled", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        runs: [run({ id: "a", biocharDryMassKg: 900 }), run({ id: "b", biocharDryMassKg: null })],
        feedstocks: [
          { id: "f", code: "FS-1", day: "2026-09-01", transportOwnerRunId: "a", legs: [{ distanceKm: 10, loadMassKg: 2000, method: "road" }] },
        ],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: null, effectiveDistanceKm: 20, deliveredWetMassKg: 1000, massDryKg: 900 },
        ],
        deliveryRunShares: [
          { ownerId: "d", runId: "a", dryMassKg: 450 },
          { ownerId: "d", runId: "b", dryMassKg: 450 },
        ],
      }),
      ALL_TIME,
    );
    const d = record(breakdown.records, "d");
    expect(d.footprint.gaps.feedstockTransport).toBeUndefined();
    expect(d.footprint.activity.feedstockTransport).toBeCloseTo(20);
    expect(d.footprint.gaps.startup).toEqual({ missing: 1, of: 2, unit: "run", recorded: true });
  });

  it("keeps missing owner transport visible alongside recorded transport in a carried mix", () => {
    const base = sharedFeedstockInputs();
    base.runs[1].biocharDryMassKg = null;
    base.feedstocks.push({ ...base.feedstocks[0], id: "other-feedstock", transportOwnerRunId: "mar" });
    base.deliveries = [{
      id: "d", code: "DL-1", day: "2026-09-20", customerName: null,
      effectiveDistanceKm: 20, deliveredWetMassKg: 1000, massDryKg: 900,
    }];
    base.deliveryRunShares = [
      { ownerId: "d", runId: "feb", dryMassKg: 450 },
      { ownerId: "d", runId: "mar", dryMassKg: 450 },
    ];
    const d = record(buildEnergyBreakdown(base, ALL_TIME).records, "d");
    expect(d.footprint.activity.feedstockTransport).toBe(500);
    expect(d.footprint.gaps.feedstockTransport).toEqual({ missing: 1, of: 2, unit: "feedstock", recorded: true });
  });

  it("counts production as missing for an application with no dry mass to scale by", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        creditBatches: [{ id: "b1", code: "CB-1", startDate: "2026-09-01", endDate: "2026-09-30" }],
        runs: [run({ id: "a", creditBatchId: "b1", biocharDryMassKg: 900 })],
        feedstocks: [
          { id: "f", code: "FS-1", day: "2026-09-01", transportOwnerRunId: "a", legs: [{ distanceKm: 10, loadMassKg: 2000, method: "road" }] },
        ],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: "Farm", effectiveDistanceKm: 20, deliveredWetMassKg: 1000, massDryKg: 900 },
        ],
        deliveryRunShares: [{ ownerId: "d", runId: "a", dryMassKg: 900 }],
        applications: [{ id: "p", code: "AP-1", day: "2026-09-25", deliveryId: "d", dryMassKg: null, fieldName: null }],
      }),
      ALL_TIME,
    );
    const p = record(breakdown.records, "p");
    for (const source of ["startup", "genset", "preprocessing", "grid", "feedstockTransport", "biocharTransport"] as const) {
      expect(p.footprint.activity[source]).toBe(0);
      expect(p.footprint.gaps[source]).toMatchObject({ missing: 1, of: 1 });
    }
    expect(p.creditBatchIds).toEqual(["b1"]);
    expect(p.runCount).toBe(1);
  });

  it("reports each credit batch's litres, kWh and tonne-km as its own record", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        creditBatches: [
          { id: "b1", code: "CB-1", startDate: "2026-09-01", endDate: "2026-09-30" },
        ],
        runs: [run({ id: "a", creditBatchId: "b1" }), run({ id: "b", creditBatchId: "b1", electricityKwh: 50 })],
        feedstocks: [
          { id: "f", code: "FS-1", day: "2026-09-01", transportOwnerRunId: "a", legs: [{ distanceKm: 10, loadMassKg: 2000, method: "road" }] },
        ],
        deliveries: [
          { id: "d", code: "DL-1", day: "2026-09-20", customerName: "Farm", effectiveDistanceKm: 25, deliveredWetMassKg: 1000, massDryKg: 450 },
        ],
        deliveryRunShares: [{ ownerId: "d", runId: "a", dryMassKg: 450 }],
      }),
      ALL_TIME,
    );
    const batch = record(breakdown.records, "b1");
    expect(batch.scope).toBe("batch");
    expect(batch.footprint.activity).toEqual({
      startup: 20,
      genset: 40,
      preprocessing: 10,
      grid: 150,
      feedstockTransport: 40,
      biocharTransport: 50,
    });
    expect(batch.runCount).toBe(2);
    expect(batch.deliveryCount).toBe(1);
    expect(batch.footprint).not.toHaveProperty("kg");
  });

  it("keeps records and flows inside the period", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({
        creditBatches: [
          { id: "old", code: "CB-OLD", startDate: "2026-07-01", endDate: "2026-07-31" },
          { id: "now", code: "CB-NOW", startDate: "2026-08-25", endDate: "2026-09-24" },
        ],
        runs: [
          run({ id: "a", day: "2026-07-10", creditBatchId: "old" }),
          run({ id: "b", day: "2026-09-10", creditBatchId: "now" }),
        ],
      }),
      { from: "2026-09-01", to: "2026-09-30" },
    );
    expect(breakdown.records.map((r) => r.id).sort()).toEqual(["b", "now"]);
    expect(new Set(breakdown.flows.map((flow) => flow.day))).toEqual(new Set(["2026-09-10"]));
    expect(breakdown.from).toBe("2026-09-01");
  });

  it("starts all time at the first recorded day", () => {
    const breakdown = buildEnergyBreakdown(
      inputs({ runs: [run({ id: "a", day: "2025-03-02" }), run({ id: "b", day: "2026-01-01" })] }),
      ALL_TIME,
    );
    expect(breakdown.from).toBe("2025-03-02");
  });
});
