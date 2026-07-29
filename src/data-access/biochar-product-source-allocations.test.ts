import { describe, expect, it } from "vitest";
import {
  InsufficientTraceableBiocharError,
  planBiocharProductSourceAllocations,
  UnresolvedBiocharDryMassError,
  type AvailableBiocharSourceLot,
} from "./biochar-product-source-allocations";

const EARLY_DATE = new Date("2026-05-01T08:00:00.000Z");
const LATE_DATE = new Date("2026-05-02T08:00:00.000Z");

function lot(
  overrides: Partial<AvailableBiocharSourceLot> = {},
): AvailableBiocharSourceLot {
  return {
    productionRunId: "run-a",
    producedAt: EARLY_DATE,
    availableWetMassKg: 50,
    availableDryMassKg: 45,
    ...overrides,
  };
}

describe("planBiocharProductSourceAllocations", () => {
  it("allocates the draw across every run by available wet mass", () => {
    const plan = planBiocharProductSourceAllocations(
      [
        lot({
          productionRunId: "run-b",
          producedAt: LATE_DATE,
          availableWetMassKg: 100,
          availableDryMassKg: 80,
        }),
        lot(),
      ],
      75,
    );

    expect(plan).toEqual({
      allocations: [
        {
          productionRunId: "run-a",
          producedAt: EARLY_DATE,
          allocatedWetMassKg: 25,
          allocatedDryMassKg: 22.5,
        },
        {
          productionRunId: "run-b",
          producedAt: LATE_DATE,
          allocatedWetMassKg: 50,
          allocatedDryMassKg: 40,
        },
      ],
      productionDate: EARLY_DATE,
      availableWetMassKg: 150,
    });
  });

  it("uses deterministic largest-remainder rounding to exact grams", () => {
    const plan = planBiocharProductSourceAllocations(
      [
        lot({
          productionRunId: "run-c",
          availableWetMassKg: 1,
          availableDryMassKg: 0.9,
        }),
        lot({
          productionRunId: "run-a",
          availableWetMassKg: 1,
          availableDryMassKg: 0.9,
        }),
        lot({
          productionRunId: "run-b",
          availableWetMassKg: 1,
          availableDryMassKg: 0.9,
        }),
      ],
      1,
    );

    expect(plan.allocations.map((allocation) => ({
      productionRunId: allocation.productionRunId,
      allocatedWetMassKg: allocation.allocatedWetMassKg,
    }))).toEqual([
      { productionRunId: "run-a", allocatedWetMassKg: 0.334 },
      { productionRunId: "run-b", allocatedWetMassKg: 0.333 },
      { productionRunId: "run-c", allocatedWetMassKg: 0.333 },
    ]);
    expect(
      plan.allocations.reduce(
        (total, allocation) => total + allocation.allocatedWetMassKg,
        0,
      ),
    ).toBe(1);
  });

  it("applies documented losses proportionally before allocating", () => {
    const plan = planBiocharProductSourceAllocations(
      [
        lot(),
        lot({
          productionRunId: "run-b",
          producedAt: LATE_DATE,
          availableWetMassKg: 100,
          availableDryMassKg: 80,
        }),
      ],
      60,
      30,
    );

    expect(plan.availableWetMassKg).toBe(120);
    expect(plan.allocations).toEqual([
      {
        productionRunId: "run-a",
        producedAt: EARLY_DATE,
        allocatedWetMassKg: 20,
        allocatedDryMassKg: 18,
      },
      {
        productionRunId: "run-b",
        producedAt: LATE_DATE,
        allocatedWetMassKg: 40,
        allocatedDryMassKg: 32,
      },
    ]);
  });

  it("apportions a one-gram loss deterministically without losing mass", () => {
    const plan = planBiocharProductSourceAllocations(
      [
        lot({
          productionRunId: "run-b",
          availableWetMassKg: 1,
          availableDryMassKg: 0.8,
        }),
        lot({
          productionRunId: "run-a",
          availableWetMassKg: 1,
          availableDryMassKg: 0.9,
        }),
      ],
      1.999,
      0.001,
    );

    expect(plan.availableWetMassKg).toBe(1.999);
    expect(plan.allocations.map((allocation) => ({
      productionRunId: allocation.productionRunId,
      allocatedWetMassKg: allocation.allocatedWetMassKg,
    }))).toEqual([
      { productionRunId: "run-a", allocatedWetMassKg: 0.999 },
      { productionRunId: "run-b", allocatedWetMassKg: 1 },
    ]);
  });

  it("blocks when any available run has unresolved dry mass", () => {
    const lots = [
      lot({
        availableWetMassKg: 10,
        availableDryMassKg: 9,
      }),
      lot({
        productionRunId: "run-b",
        producedAt: LATE_DATE,
        availableWetMassKg: 10,
        availableDryMassKg: null,
      }),
    ];

    expect(() =>
      planBiocharProductSourceAllocations(lots, 10),
    ).toThrowError(
      expect.objectContaining({
        productionRunId: "run-b",
      }) as UnresolvedBiocharDryMassError,
    );
  });

  it("reports traceable stock after proportional loss when a draw is too large", () => {
    expect(() =>
      planBiocharProductSourceAllocations([lot()], 41, 10),
    ).toThrowError(
      expect.objectContaining({
        availableWetMassKg: 40,
        requestedWetMassKg: 41,
      }) as InsufficientTraceableBiocharError,
    );
  });

  it("returns no allocations for a zero draw", () => {
    expect(
      planBiocharProductSourceAllocations([lot()], 0, 10),
    ).toEqual({
      allocations: [],
      productionDate: null,
      availableWetMassKg: 40,
    });
  });
});
