import { describe, expect, it } from "vitest";
import {
  planBiocharProductSourceAllocations,
  UnresolvedBiocharDryMassError,
  type AvailableBiocharSourceLot,
} from "./biochar-product-source-allocations";

const EARLY_DATE = new Date("2026-05-01T08:00:00.000Z");
const LATE_DATE = new Date("2026-05-02T08:00:00.000Z");
const GRAMS_PER_KG = 1000;
function lot(overrides: Partial<AvailableBiocharSourceLot> = {}): AvailableBiocharSourceLot {
  return { productionRunId: "run-a", producedAt: EARLY_DATE, availableWetMassKg: 50, availableDryMassKg: 45, ...overrides };
}
const laterLot = () => lot({ productionRunId: "run-b", producedAt: LATE_DATE, availableWetMassKg: 100, availableDryMassKg: 80 });

describe("source allocation adapter for measured dry FIFO", () => {
  it("consumes the physically oldest run before drawing from a later run", () => {
    const plan = planBiocharProductSourceAllocations([laterLot(), lot()], 75, 0, 60);
    expect(plan.allocations).toEqual([
      { productionRunId: "run-a", producedAt: EARLY_DATE, allocatedWetMassKg: 56.25, allocatedDryMassKg: 45 },
      { productionRunId: "run-b", producedAt: LATE_DATE, allocatedWetMassKg: 18.75, allocatedDryMassKg: 15 },
    ]);
    expect(plan.productionDate).toEqual(EARLY_DATE);
    expect(plan.availableWetMassKg).toBe(156.25);
  });

  it("leaves later source runs unused when the first run has enough dry stock", () => {
    const plan = planBiocharProductSourceAllocations([lot(), laterLot()], 10, 0, 8);
    expect(plan.allocations).toEqual([
      { productionRunId: "run-a", producedAt: EARLY_DATE, allocatedWetMassKg: 10, allocatedDryMassKg: 8 },
    ]);
  });

  it("preserves supplied posting order for runs on the same physical day", () => {
    const lots = [lot({ productionRunId: "run-c" }), lot({ productionRunId: "run-a" }), lot({ productionRunId: "run-b" })];
    const plan = planBiocharProductSourceAllocations(lots, 1, 0, 0.9);
    expect(plan.allocations.map(row => row.productionRunId)).toEqual(["run-c"]);
    expect(planBiocharProductSourceAllocations(lots, 1, 0, 0.9)).toEqual(plan);
  });

  it("conserves every measured wet and dry gram when FIFO crosses tiny source lots", () => {
    const lots = ["a", "b", "c"].map(id => lot({ productionRunId: id, availableWetMassKg: 0.002, availableDryMassKg: 0.001 }));
    const plan = planBiocharProductSourceAllocations(lots, 0.004, 0, 0.003);
    expect(plan.allocations.map(row => row.allocatedWetMassKg)).toEqual([0.001, 0.002, 0.001]);
    expect(plan.allocations.reduce((sum, row) => sum + Math.round(row.allocatedWetMassKg * GRAMS_PER_KG), 0)).toBe(4);
    expect(plan.allocations.reduce((sum, row) => sum + Math.round(row.allocatedDryMassKg * GRAMS_PER_KG), 0)).toBe(3);
  });

  it("requires a measured dry draw instead of inferring it from recorded input wet mass", () => {
    expect(() => planBiocharProductSourceAllocations([lot()], 10)).toThrow("Measured source dry mass is required");
  });

  it.each([30, 0.001])("rejects an unposted %s kg loss instead of redistributing source provenance", loss => {
    expect(() => planBiocharProductSourceAllocations([lot()], 10, loss, 8)).toThrow("Losses require posted dry-solids provenance");
  });

  it("fails closed when a source run has unresolved dry mass", () => {
    expect(() => planBiocharProductSourceAllocations([lot({ availableDryMassKg: null })], 10, 0, 8))
      .toThrow(UnresolvedBiocharDryMassError);
  });

  it("also rejects an unresolved later run rather than treating unknown stock as zero", () => {
    expect(() => planBiocharProductSourceAllocations([lot(), laterLot(), lot({ productionRunId: "unknown", producedAt: LATE_DATE, availableDryMassKg: null })], 0.001, 0, 0.001))
      .toThrow("Biochar dry mass is unresolved");
  });

  it("checks the provided remaining dry balance after previously posted losses", () => {
    const remaining = lot({ availableDryMassKg: 35 });
    expect(() => planBiocharProductSourceAllocations([remaining], 40, 0, 36)).toThrow("Insufficient exact dry solids");
    expect(planBiocharProductSourceAllocations([remaining], 40, 0, 35).allocations[0].allocatedDryMassKg).toBe(35);
  });

  it("uses dry capacity independently of historical wet feasibility estimates", () => {
    const source = lot({ availableWetMassKg: 10, feasibilityWetMassKg: 5, availableDryMassKg: 45 });
    const plan = planBiocharProductSourceAllocations([source], 90, 0, 45);
    expect(plan.allocations[0]).toMatchObject({ allocatedWetMassKg: 90, allocatedDryMassKg: 45 });
    expect(plan.availableWetMassKg).toBe(90);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0])("rejects invalid measured wet mass %s", requestedWetMassKg => {
    expect(() => planBiocharProductSourceAllocations([lot()], requestedWetMassKg, 0, 1)).toThrow();
  });

  it("continues FIFO past a source capped by its remaining dry stock", () => {
    const plan = planBiocharProductSourceAllocations([lot({ availableDryMassKg: 10 }), laterLot()], 100, 0, 55);
    expect(plan.allocations.map(row => [row.productionRunId, row.allocatedDryMassKg, row.allocatedWetMassKg])).toEqual([
      ["run-a", 10, 18.182], ["run-b", 45, 81.818],
    ]);
  });

  it("rejects a zero measured dry draw instead of posting source rows with no dry stock", () => {
    expect(() => planBiocharProductSourceAllocations([lot()], 10, 0, 0)).toThrow("Source dry mass must be positive");
  });

  it("rejects measured dry mass beyond all available source lots", () => {
    expect(() => planBiocharProductSourceAllocations([lot({ availableDryMassKg: 40 })], 50, 0, 45)).toThrow("Insufficient exact dry solids");
  });

  it("rejects measured dry mass above the measured wet draw", () => {
    expect(() => planBiocharProductSourceAllocations([lot()], 10, 0, 11)).toThrow("no greater than wet mass");
  });

  it("rejects duplicate source run identities rather than double-counting stock", () => {
    expect(() => planBiocharProductSourceAllocations([lot(), lot()], 10, 0, 8)).toThrow("duplicate layer identity");
  });
});
