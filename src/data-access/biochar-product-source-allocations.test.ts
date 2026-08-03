import { describe, expect, it } from "vitest";
import {
  InsufficientSourceDryMassError,
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

  it("blocks when an allocated run has unresolved dry mass", () => {
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

  it("does not block on an unresolved run that receives zero grams", () => {
    const plan = planBiocharProductSourceAllocations(
      [
        lot(),
        lot({
          productionRunId: "run-b",
          producedAt: LATE_DATE,
          availableWetMassKg: 0.001,
          availableDryMassKg: null,
        }),
      ],
      0.001,
    );

    expect(plan.allocations).toEqual([
      {
        productionRunId: "run-a",
        producedAt: EARLY_DATE,
        allocatedWetMassKg: 0.001,
        allocatedDryMassKg: 0.001,
      },
    ]);
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

  it("lets an over-allocated lot reduce total feasibility", () => {
    expect(() =>
      planBiocharProductSourceAllocations(
        [
          lot({
            availableWetMassKg: 0,
            availableDryMassKg: 0,
            feasibilityWetMassKg: -20,
          }),
          lot({
            productionRunId: "run-b",
            producedAt: LATE_DATE,
            availableWetMassKg: 100,
            availableDryMassKg: 80,
            feasibilityWetMassKg: 100,
          }),
        ],
        90,
      ),
    ).toThrowError(
      expect.objectContaining({
        availableWetMassKg: 80,
        requestedWetMassKg: 90,
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

  it.each([
    ["null", null as unknown as number],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["negative", -1],
  ])("rejects a %s requested source mass", (_case, requestedWetMassKg) => {
    expect(() =>
      planBiocharProductSourceAllocations([lot()], requestedWetMassKg),
    ).toThrow("requestedWetMassKg must be a finite number at or above 0");
  });

  it("spreads a measured dry draw across lots by wet allocation", () => {
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
      0,
      60,
    );

    expect(plan.allocations).toEqual([
      {
        productionRunId: "run-a",
        producedAt: EARLY_DATE,
        allocatedWetMassKg: 25,
        allocatedDryMassKg: 20,
      },
      {
        productionRunId: "run-b",
        producedAt: LATE_DATE,
        allocatedWetMassKg: 50,
        allocatedDryMassKg: 40,
      },
    ]);
  });

  it("re-spreads dry mass past a lot capped by its remaining dry stock", () => {
    const plan = planBiocharProductSourceAllocations(
      [
        lot({ availableWetMassKg: 50, availableDryMassKg: 10 }),
        lot({
          productionRunId: "run-b",
          producedAt: LATE_DATE,
          availableWetMassKg: 50,
          availableDryMassKg: 50,
        }),
      ],
      100,
      0,
      55,
    );

    expect(plan.allocations).toEqual([
      {
        productionRunId: "run-a",
        producedAt: EARLY_DATE,
        allocatedWetMassKg: 50,
        allocatedDryMassKg: 10,
      },
      {
        productionRunId: "run-b",
        producedAt: LATE_DATE,
        allocatedWetMassKg: 50,
        allocatedDryMassKg: 45,
      },
    ]);
  });

  it("keeps a zero measured dry draw at zero dry per lot", () => {
    const plan = planBiocharProductSourceAllocations([lot()], 10, 0, 0);

    expect(plan.allocations).toEqual([
      {
        productionRunId: "run-a",
        producedAt: EARLY_DATE,
        allocatedWetMassKg: 10,
        allocatedDryMassKg: 0,
      },
    ]);
  });

  it("rejects a measured dry draw beyond the lots' traceable dry stock", () => {
    expect(() =>
      planBiocharProductSourceAllocations(
        [lot({ availableWetMassKg: 50, availableDryMassKg: 40 })],
        50,
        0,
        45,
      ),
    ).toThrowError(
      expect.objectContaining({
        availableDryMassKg: 40,
        requestedDryMassKg: 45,
      }) as InsufficientSourceDryMassError,
    );
  });

  it("rejects a measured dry draw above the wet draw", () => {
    expect(() =>
      planBiocharProductSourceAllocations([lot()], 10, 0, 11),
    ).toThrow("requestedDryMassKg cannot exceed requestedWetMassKg");
  });

  it("blocks a measured dry draw when an allocated run has unresolved dry mass", () => {
    expect(() =>
      planBiocharProductSourceAllocations(
        [lot({ availableDryMassKg: null })],
        10,
        0,
        9,
      ),
    ).toThrowError(
      expect.objectContaining({
        productionRunId: "run-a",
      }) as UnresolvedBiocharDryMassError,
    );
  });
});
