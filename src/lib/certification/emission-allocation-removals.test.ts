import { describe, expect, it } from "vitest";
import { buildEmissionAllocation } from "./emission-allocation";
import type { EmissionAllocationFacts } from "./emission-allocation-facts";
import { NOT_YET } from "@/types/emission-allocation";

const BATCH = "batch";
const FIRST = "initial-removal";
const FOLLOWUP = "follow-up-removal";
const DATE = "2026-06-01";
const LOAD_KG = 300;
const INITIAL_KG = 150;
const FOLLOWUP_KG = 50;

function facts(): EmissionAllocationFacts {
  return {
    facilityId: "facility", batches: [{ id: BATCH, code: "CB-1", startDate: DATE, endDate: DATE }],
    removals: [FIRST, FOLLOWUP].map(id => ({ id, code: id, status: "draft", creditBatchIds: [BATCH] })),
    productionClaims: { [BATCH]: FIRST },
    feedstocks: [{ id: "feedstock", code: "FS-1", date: DATE, binId: "bin", binName: "Bin", runsByBatch: {},
      legs: [{ id: "leg", oneWayKm: 10, loadKg: 1000 }],
      firstRun: { id: "run", code: "PR-1", date: DATE, creditBatchId: BATCH },
      usage: { id: "feedstock", code: "FS-1", intakeWetKg: 1000, stillInBinWetKg: 0, lostWetKg: 0,
        countWetKg: 0, ingredientWetKg: 0, unbatchedRunWetKg: 0, owningBatch: { creditBatchId: BATCH, code: "CB-1" },
        creditBatches: [{ creditBatchId: BATCH, code: "CB-1", wetKg: 1000 }] } }],
    runs: [{ id: "run", code: "PR-1", date: DATE, creditBatchId: BATCH, reactorId: null, reactorCode: null,
      dieselOperationLiters: 10, dieselGensetLiters: 2, preprocessingFuelLiters: 1, electricityKwh: 20 }],
    deliveries: [{ id: "delivery", code: "DL-1", date: DATE, wetKg: LOAD_KG, oneWayKm: 10,
      loads: [{ creditBatchId: BATCH, code: "CB-1", kg: LOAD_KG }],
      removalLoads: [{ removalId: FIRST, code: FIRST, kg: INITIAL_KG }, { removalId: FOLLOWUP, code: FOLLOWUP, kg: FOLLOWUP_KG }] }],
    manual: [{ id: "entry", componentId: "diesel", componentName: "Diesel", date: DATE, creditBatchId: BATCH,
      kind: "value", quantities: [{ value: 5, unit: "L", label: "Diesel" }], omittedInputKeys: [], removalId: FOLLOWUP }],
  };
}

const shares = (input: EmissionAllocationFacts) => buildEmissionAllocation(input).records;

describe("Removal allocation follows submission ownership", () => {
  it("front-loads production and feedstock once, splits delivery by slices, and claims entries separately", () => {
    const input = facts();
    const snapshot = structuredClone(input);
    const records = shares(input);
    for (const record of records) {
      expect(record.removalParts.reduce((sum, part) => sum + part.fraction, 0)).toBe(1);
      expect(record.removalParts.every(part => part.fraction >= 0 && part.fraction <= 1)).toBe(true);
      if (record.group === "production" || record.group === "feedstockTransport") {
        expect(record.removalParts).toEqual([{ key: FIRST, fraction: 1,
          basis: [{ kind: "claim", label: record.code, kg: null }] }]);
      }
    }
    const delivery = records.find(record => record.group === "deliveryTransport")!;
    expect(delivery.removalParts.map(part => part.key)).toEqual([FIRST, FOLLOWUP, NOT_YET]);
    expect(delivery.removalParts.map(part => part.basis[0].kg)).toEqual([INITIAL_KG, FOLLOWUP_KG, 100]);
    expect(delivery.removalParts[0].fraction).toBe(INITIAL_KG / LOAD_KG);
    expect(delivery.removalParts[1].fraction).toBe(FOLLOWUP_KG / LOAD_KG);
    delivery.removalParts.forEach((part, index) => {
      expect(part.fraction * delivery.quantities[0].value!).toBeCloseTo([3, 1, 2][index]);
    });
    expect(records.find(record => record.group === "manual")?.removalParts[0]).toMatchObject({ key: FOLLOWUP, fraction: 1 });
    expect(input).toEqual(snapshot);
  });

  it("keeps applied mass with no Removal and unclaimed production entirely not yet allocated", () => {
    const input = facts();
    input.removals = [];
    input.productionClaims = {};
    input.deliveries[0].removalLoads = [];
    input.manual[0].removalId = null;
    for (const record of shares(input)) {
      expect(record.removalParts).toEqual([{ key: NOT_YET, fraction: 1,
        basis: [{ kind: "notYet", label: record.code, kg: record.group === "deliveryTransport" ? LOAD_KG : null }] }]);
      expect(record.parts[0]).toMatchObject({ key: BATCH, fraction: 1 });
    }
  });

  it("previews all production in the only draft before a persisted claim exists", () => {
    const input = facts();
    input.productionClaims = {};
    input.removals = input.removals.slice(0, 1);
    for (const record of shares(input).filter(record => ["production", "feedstockTransport"].includes(record.group))) {
      expect(record.removalParts).toEqual([{ key: FIRST, fraction: 1,
        basis: [{ kind: "wouldClaim", label: record.code, kg: null }] }]);
      expect(record.removalParts.reduce((sum, part) => sum + part.fraction, 0)).toBe(1);
    }
  });

  it("keeps a retryable rejected Removal as the sole production candidate", () => {
    const input = facts();
    input.productionClaims = {};
    input.removals = [{ id: FIRST, code: FIRST, status: "rejected", creditBatchIds: [BATCH], canSendProduction: true }];
    expect(shares(input).find(record => record.group === "production")?.removalParts)
      .toEqual([expect.objectContaining({ key: FIRST, fraction: 1 })]);
  });

  it("leaves production unallocated when a retryable Removal and a draft both could send it", () => {
    const input = facts();
    input.productionClaims = {};
    input.removals = [
      { id: FIRST, code: FIRST, status: "rejected", creditBatchIds: [BATCH], canSendProduction: true },
      { id: FOLLOWUP, code: FOLLOWUP, status: "draft", creditBatchIds: [BATCH], canSendProduction: true },
    ];
    expect(shares(input).find(record => record.group === "production")?.removalParts[0]).toMatchObject({ key: NOT_YET, fraction: 1 });
  });

  it("never elects a rejected Removal the registry already holds", () => {
    const input = facts();
    input.productionClaims = {};
    input.removals = [
      { id: FIRST, code: FIRST, status: "rejected", creditBatchIds: [BATCH], canSendProduction: false },
      { id: FOLLOWUP, code: FOLLOWUP, status: "draft", creditBatchIds: [BATCH], canSendProduction: true },
    ];
    expect(shares(input).find(record => record.group === "production")?.removalParts)
      .toEqual([expect.objectContaining({ key: FOLLOWUP, fraction: 1 })]);
  });

  it("does not elect a production claimer from draft membership", () => {
    const input = facts();
    input.productionClaims = {};
    expect(shares(input).find(record => record.group === "production")?.removalParts[0]).toMatchObject({ key: NOT_YET, fraction: 1 });
  });

  it("uses the submit gate's ordered active attempts and preserves reserved or persisted owners", () => {
    const input = facts();
    input.productionClaims = {};
    input.productionContenders = [{ creditBatchId: BATCH, removalId: FOLLOWUP }, { creditBatchId: BATCH, removalId: FIRST }];
    const production = () => shares(input).filter(record => ["production", "feedstockTransport"].includes(record.group));
    for (const record of production()) expect(record.removalParts[0]).toMatchObject({ key: FOLLOWUP, fraction: 1, basis: [{ kind: "wouldClaim" }] });
    input.productionReservations = { [BATCH]: FIRST };
    for (const record of production()) expect(record.removalParts[0]).toMatchObject({ key: FIRST, fraction: 1, basis: [{ kind: "wouldClaim" }] });
    input.productionClaims = { [BATCH]: FOLLOWUP };
    for (const record of production()) expect(record.removalParts[0]).toMatchObject({ key: FOLLOWUP, fraction: 1, basis: [{ kind: "claim" }] });
    input.productionClaims = {};
    input.productionReservations = { [BATCH]: null };
    for (const record of production()) expect(record.removalParts[0]).toMatchObject({ key: NOT_YET, fraction: 1 });
  });

  it("marks pending manual entries and frozen delivery slices without changing their shares", () => {
    const input = facts();
    input.manual[0].pending = true;
    input.deliveries[0].removalLoads![0].pending = true;
    const records = shares(input);
    expect(records.find(record => record.group === "manual")!.removalParts[0]).toMatchObject({ key: FOLLOWUP, basis: [{ kind: "wouldClaim" }] });
    expect(records.find(record => record.group === "deliveryTransport")!.removalParts[0])
      .toMatchObject({ key: FIRST, fraction: INITIAL_KG / LOAD_KG, basis: [{ kind: "wouldClaim", kg: INITIAL_KG }] });
  });

  it("conserves repeating shares exactly and rejects slices above the whole load", () => {
    const input = facts();
    input.deliveries[0].wetKg = 7;
    input.deliveries[0].loads = [{ creditBatchId: BATCH, code: "CB-1", kg: 7 }];
    input.deliveries[0].removalLoads = Array.from({ length: 7 }, (_, i) => ({ removalId: `removal-${i}`, code: `RM-${i}`, kg: 1 }));
    const parts = shares(input).find(record => record.group === "deliveryTransport")!.removalParts;
    expect(parts.reduce((sum, part) => sum + part.fraction, 0)).toBe(1);
    expect(parts.some(part => part.key === NOT_YET)).toBe(false);
    input.deliveries[0].removalLoads.push({ removalId: "excess", code: "RM-excess", kg: 1 });
    expect(() => shares(input)).toThrow("Removal application slices exceed the whole delivery load");
  });
});
