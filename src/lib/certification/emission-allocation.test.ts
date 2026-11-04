import { describe, expect, it } from "vitest";
import { buildAllocationManualFacts } from "./emission-allocation-manual";
import type { TemplateDefinition } from "@/lib/isometric/template-observations/types";
import { buildEmissionAllocation } from "./emission-allocation";
import type { AllocationFeedstockFact, AllocationRunFact, EmissionAllocationFacts } from "./emission-allocation-facts";
import { NOT_YET } from "@/types/emission-allocation";

const BATCH_A = "batch-a";
const BATCH_B = "batch-b";
const DATE = "2026-02-01";
const INTAKE_KG = 10_000;
const ONE_WAY_KM = 42;
const WHOLE_LEG_TONNE_KM = 840;

function facts(): EmissionAllocationFacts {
  return { facilityId: "facility", batches: [BATCH_A, BATCH_B].map((id, index) => ({ id, code: `CB-${index}`,
    startDate: DATE, endDate: "2026-02-28" })), removals: [], feedstocks: [], runs: [], deliveries: [], manual: [] };
}
function stock(): AllocationFeedstockFact {
  return { id: "stock", code: "FS-1", date: DATE, binId: "bin", binName: "North bay", runsByBatch: {},
    legs: [{ id: "leg", oneWayKm: ONE_WAY_KM, loadKg: INTAKE_KG }],
    usage: { id: "stock", code: "FS-1", intakeWetKg: INTAKE_KG, stillInBinWetKg: INTAKE_KG,
      lostWetKg: 0, countWetKg: 0, ingredientWetKg: 0, creditBatches: [], unbatchedRunWetKg: 0, owningBatch: null } };
}
function run(creditBatchId: string | null): AllocationRunFact {
  return { id: `run-${creditBatchId}`, code: `PR-${creditBatchId}`, date: DATE, creditBatchId,
    reactorId: "reactor", reactorCode: "RX-1", dieselOperationLiters: 22, dieselGensetLiters: 8,
    preprocessingFuelLiters: 4, electricityKwh: 168 };
}

describe("buildEmissionAllocation", () => {
  it("puts the whole leg on the first touching batch, retaining later usage at zero percent", () => {
    const input = facts();
    const feedstock = stock();
    feedstock.usage.owningBatch = { creditBatchId: BATCH_A, code: "CB-0" };
    feedstock.usage.creditBatches = [
      { creditBatchId: BATCH_A, code: "CB-0", wetKg: 4_000 },
      { creditBatchId: BATCH_B, code: "CB-1", wetKg: 2_000 },
    ];
    feedstock.usage.stillInBinWetKg = 4_000;
    feedstock.runsByBatch = { [BATCH_A]: ["PR-1"], [BATCH_B]: ["PR-2"] };
    feedstock.firstRun = { id: "run-1", code: "PR-1", date: DATE, creditBatchId: BATCH_A };
    input.feedstocks = [feedstock];
    const [record] = buildEmissionAllocation(input).records;
    expect(record.quantities).toEqual([{ value: WHOLE_LEG_TONNE_KM, unit: "t·km", label: "Transport" }]);
    expect(record.parts.map(({ key, fraction }) => ({ key, fraction }))).toEqual([
      { key: BATCH_A, fraction: 1 }, { key: BATCH_B, fraction: 0 },
    ]);
    expect(record.feedstock).toMatchObject({ owner: BATCH_A, reason: "firstRun", firstRun: feedstock.firstRun,
      used: [{ creditBatchId: BATCH_A, kg: 4_000, runs: ["PR-1"] }, { creditBatchId: BATCH_B, kg: 2_000, runs: ["PR-2"] }], stillKg: 4_000 });
  });

  it("leaves an untouched delivery fully not yet allocated", () => {
    const input = facts();
    input.feedstocks = [stock()];
    const [record] = buildEmissionAllocation(input).records;
    expect(record.parts).toEqual([{ key: NOT_YET, fraction: 1, basis: [{ kind: "notYet", label: "North bay", kg: INTAKE_KG }] }]);
    expect(record.feedstock).toMatchObject({ owner: null, reason: "notYet", stillKg: INTAKE_KG });
  });

  it("never assigns an owner from lost mass, counts, or product ingredient use", () => {
    const input = facts();
    const feedstock = stock();
    Object.assign(feedstock.usage, { lostWetKg: 1_000, countWetKg: 500, ingredientWetKg: 2_000, stillInBinWetKg: 6_500 });
    input.feedstocks = [feedstock];
    const [record] = buildEmissionAllocation(input).records;
    expect(record.parts[0]).toMatchObject({ key: NOT_YET, fraction: 1 });
    expect(record.feedstock).toMatchObject({ lostKg: 1_000, owner: null, ingredientKg: 2_000, countKg: 500,
      out: [{ kind: "lost", date: null, kg: 1_000 }] });
  });

  it.each([BATCH_A, null])("assigns a run with batch %s in full", creditBatchId => {
    const input = facts();
    input.runs = [run(creditBatchId)];
    const [record] = buildEmissionAllocation(input).records;
    expect(record.parts[0]).toMatchObject({ key: creditBatchId ?? NOT_YET, fraction: 1 });
    expect(record.quantities.map(quantity => quantity.value)).toEqual([22, 8, 4, 168]);
  });

  it("splits a biochar delivery by each batch's mass on the whole load, including round trip", () => {
    const input = facts();
    input.deliveries = [{ id: "delivery", code: "DL-1", date: DATE, wetKg: 4_000, oneWayKm: 88,
      loads: [{ creditBatchId: BATCH_A, code: "CB-0", kg: 1_200 }, { creditBatchId: BATCH_B, code: "CB-1", kg: 2_800 }] }];
    const [record] = buildEmissionAllocation(input).records;
    expect(record.quantities[0].value).toBe(704);
    expect(record.parts.map(part => part.fraction)).toEqual([0.3, 0.7]);
    expect(record.parts.map(part => part.basis[0].kg)).toEqual([1_200, 2_800]);
  });

  it("keeps the unbatched part of a physical load not yet allocated", () => {
    const input = facts();
    input.deliveries = [{ id: "delivery", code: "DL-1", date: DATE, wetKg: 1_000, oneWayKm: 10,
      loads: [{ creditBatchId: BATCH_A, code: "CB-0", kg: 400 }] }];
    expect(buildEmissionAllocation(input).records[0].parts.map(({ key, fraction }) => ({ key, fraction }))).toEqual([
      { key: BATCH_A, fraction: 0.4 }, { key: NOT_YET, fraction: 0.6 },
    ]);
  });

  it("does not create a not-yet remainder from floating point rounding on a fully assigned load", () => {
    const input = facts();
    input.deliveries = [{ id: "delivery", code: "DL-1", date: DATE, wetKg: 7, oneWayKm: 10,
      loads: Array.from({ length: 7 }, (_, index) => ({ creditBatchId: `batch-${index}`, code: `CB-${index}`, kg: 1 })) }];
    const [record] = buildEmissionAllocation(input).records;
    expect(record.parts.some(part => part.key === NOT_YET)).toBe(false);
    expect(record.parts.reduce((sum, part) => sum + part.fraction, 0)).toBe(1);
  });

  it("keeps a manual entry on its recorded batch", () => {
    const input = facts();
    input.manual = [{ id: "entry", componentId: "loader-diesel", componentName: "Loader diesel usage", date: DATE, creditBatchId: BATCH_B, kind: "value",
      quantities: [{ value: 46, unit: "L", label: "Diesel" }], omittedInputKeys: [] }];
    const [record] = buildEmissionAllocation(input).records;
    expect(record).toMatchObject({ id: "entry", code: "loader-diesel", group: "manual", detail: { kind: "manual", componentId: "loader-diesel", componentName: "Loader diesel usage" },
      quantities: input.manual[0].quantities });
    expect(record.parts[0]).toMatchObject({ key: BATCH_B, fraction: 1 });
  });

  it("preserves missing readings and unknown load shares", () => {
    const input = facts();
    input.runs = [{ ...run(BATCH_A), electricityKwh: null }];
    input.feedstocks = [{ ...stock(), legs: [] }];
    input.deliveries = [{ id: "delivery", code: "DL-1", date: DATE, wetKg: null, oneWayKm: null,
      loads: [{ creditBatchId: BATCH_A, code: "CB-0", kg: null }] }];
    const result = buildEmissionAllocation(input);
    expect(result.records.find(record => record.group === "production")?.quantities.at(-1)?.value).toBeNull();
    expect(result.records.find(record => record.group === "feedstockTransport")?.quantities[0].value).toBeNull();
    expect(result.records.find(record => record.group === "deliveryTransport")?.parts).toContainEqual(
      expect.objectContaining({ key: NOT_YET, fraction: 1 }));
  });

  it("sums fractions to exactly one for all groups, including repeating decimal shares", () => {
    const input = facts();
    input.feedstocks = [stock()];
    input.runs = [run(BATCH_A), run(null)];
    input.deliveries = [{ id: "delivery", code: "DL-1", date: DATE, wetKg: 3, oneWayKm: 10,
      loads: [BATCH_A, BATCH_B].map(creditBatchId => ({ creditBatchId, code: creditBatchId, kg: 1 })) }];
    input.manual = [{ id: "entry", componentId: "grid", componentName: "Grid electricity", date: DATE, creditBatchId: BATCH_A, kind: "value",
      quantities: [{ value: 310, unit: "kWh", label: "Electricity" }], omittedInputKeys: [] }];
    const snapshot = structuredClone(input);
    for (const record of buildEmissionAllocation(input).records) {
      expect(record.parts.reduce((sum, part) => sum + part.fraction, 0)).toBe(1);
      expect(record.parts.every(part => part.fraction >= 0 && part.fraction <= 1)).toBe(true);
    }
    expect(input).toEqual(snapshot);
  });
});

describe("manual allocation display names", () => {
  const entry = { id: "entry", componentId: "loader-diesel", creditBatchId: BATCH_B,
    removalTemplateId: "template", observationId: "previous", occurredOn: DATE, kind: "value" as const,
    values: [{ inputKey: "volume_of_fuel", magnitude: "46000", unit: "mL" }] };
  const definition: TemplateDefinition = { groups: [{ id: "group", key: "pyrolysis", displayName: "Pyrolysis", description: "",
    components: [{ id: entry.componentId, displayName: "Loader diesel usage", description: null, blueprintKey: "diesel",
      inputs: [{ key: "volume_of_fuel", type: "monitored", quantityKind: "volume" }] }] }] };
  const previous = { id: "previous", externalTemplateId: "template", definition };

  it("uses the current component name while preserving the component code", () => {
    const renamed = structuredClone(definition);
    renamed.groups[0].components[0].displayName = "Wheel loader diesel";
    const input = facts();
    input.manual = buildAllocationManualFacts([entry], [{ ...previous, id: "current", definition: renamed }], [previous]);
    expect(buildEmissionAllocation(input).records[0]).toMatchObject({ code: entry.componentId,
      detail: { kind: "manual", componentName: "Wheel loader diesel" },
      quantities: [{ value: 46, unit: "L", label: "Diesel" }] });
  });

  it("retains removed component names through the same definition helper as Emissions", () => {
    const [fact] = buildAllocationManualFacts([entry], [{ ...previous, id: "current", definition: { groups: [] } }], [previous]);
    expect(fact.componentName).toBe("Loader diesel usage");
    expect(fact.quantities).toEqual([{ value: 46, unit: "L", label: "Diesel" }]);
  });

  it("falls back to the component ID only when definitions cannot supply the name", () => {
    const [missing] = buildAllocationManualFacts([entry], [{ ...previous, definition: { groups: [] } }], []);
    expect(missing.componentName).toBe(entry.componentId);
    const [fact] = buildAllocationManualFacts([{ ...entry, values: [...entry.values,
      { inputKey: "unknown_energy", magnitude: "2", unit: "MWh" },
      { inputKey: "factor", magnitude: "3", unit: "kgCO2e / L" }] }], [previous], []);
    expect(fact.componentName).toBe("Loader diesel usage");
    expect(fact.quantities).toEqual([{ value: 46, unit: "L", label: "Diesel" },
      { value: 2000, unit: "kWh", label: "Electricity" }]);
    expect(fact.omittedInputKeys).toEqual(["factor"]);
  });

  it("uses the recorded definition if there is no current observation", () => {
    expect(buildAllocationManualFacts([entry], [], [previous])[0].componentName).toBe("Loader diesel usage");
  });
});
