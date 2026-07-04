import { describe, it, expect } from "vitest";
import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { computeCohortInputTotals } from "./cohort-input-ledger";

function makeRun(
  overrides: Partial<CreditBatchProductionRunOption> = {},
): CreditBatchProductionRunOption {
  return {
    id: "run-1",
    code: "PR-26-001",
    date: "2026-05-13",
    status: "completed",
    biocharDryMassKg: null,
    feedstockMassDryKg: null,
    dieselOperationLiters: null,
    dieselGensetLiters: null,
    preprocessingFuelLiters: null,
    electricityKwh: null,
    feedstockTypeIds: [],
    assignedCreditBatchId: null,
    assignedCreditBatchCode: null,
    ...overrides,
  };
}

describe("computeCohortInputTotals", () => {
  it("returns all-null totals for an empty cohort", () => {
    expect(computeCohortInputTotals([])).toEqual({
      dryOutputKg: null,
      feedstockDryKg: null,
      dieselLiters: null,
      electricityKwh: null,
    });
  });

  it("sums each input across the selected runs", () => {
    const totals = computeCohortInputTotals([
      makeRun({
        biocharDryMassKg: 960,
        feedstockMassDryKg: 3100,
        electricityKwh: 210,
      }),
      makeRun({
        id: "run-2",
        biocharDryMassKg: 830,
        feedstockMassDryKg: 2700,
        electricityKwh: 185,
      }),
    ]);
    expect(totals.dryOutputKg).toBe(1790);
    expect(totals.feedstockDryKg).toBe(5800);
    expect(totals.electricityKwh).toBe(395);
  });

  it("combines startup and genset diesel into one total", () => {
    const totals = computeCohortInputTotals([
      makeRun({
        dieselOperationLiters: 20,
        dieselGensetLiters: 15,
        preprocessingFuelLiters: 7,
      }),
      makeRun({ id: "run-2", dieselGensetLiters: 10 }),
    ]);
    expect(totals.dieselLiters).toBe(52);
  });

  it("treats a fully-unreported category as null, not zero", () => {
    const totals = computeCohortInputTotals([
      makeRun({ biocharDryMassKg: 500 }),
    ]);
    expect(totals.dryOutputKg).toBe(500);
    // No run reported feedstock/diesel/electricity → distinguish "not entered".
    expect(totals.feedstockDryKg).toBeNull();
    expect(totals.dieselLiters).toBeNull();
    expect(totals.electricityKwh).toBeNull();
  });

  it("still totals a category when only some runs report it", () => {
    const totals = computeCohortInputTotals([
      makeRun({ electricityKwh: 100 }),
      makeRun({ id: "run-2", electricityKwh: null }),
    ]);
    expect(totals.electricityKwh).toBe(100);
  });
});
