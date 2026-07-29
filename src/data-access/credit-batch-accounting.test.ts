import { describe, expect, it } from "vitest";
import {
  splitApplicationAcrossSourceAllocations,
} from "./biochar-product-application-allocation";
import type { BatchLineageApplicationFact } from "./credit-batch-accounting";

function application(): BatchLineageApplicationFact {
  return {
    id: "application-1",
    code: "Application 1",
    status: "applied",
    applicationDate: new Date("2026-07-04T00:00:00.000Z"),
    fieldIdentifier: "Field 1",
    evidenceMethod: "boundary",
    gisBoundary: null,
    biocharAppliedTons: 4,
    biocharAppliedDryTons: 2,
    sourceAllocation: null,
    soilTemperatureC: null,
    facility: { id: "facility-1", code: "Facility 1", name: "Facility" },
    delivery: {
      id: "delivery-1",
      code: "Delivery 1",
      status: "delivered",
      deliveryDate: new Date("2026-07-03T00:00:00.000Z"),
      deliveredWetMassKg: 4_000,
      massDryKg: 2_000,
    },
    order: null,
    biocharProduct: {
      id: "product-1",
      code: "Product 1",
      status: "ready",
      productionDate: new Date("2026-07-02T00:00:00.000Z"),
      massKg: 4_000,
      moistureContentPercent: 50,
      formulationName: null,
      linkedProductionRunId: "legacy-run",
    },
  };
}

describe("splitApplicationAcrossSourceAllocations", () => {
  it("conserves wet and dry application mass with independent lot weights", () => {
    const slices = splitApplicationAcrossSourceAllocations(application(), [
      {
        productionRunId: "run-b",
        allocatedWetMassKg: 150,
        allocatedDryMassKg: 60,
      },
      {
        productionRunId: "run-a",
        allocatedWetMassKg: 50,
        allocatedDryMassKg: 40,
      },
    ]);

    expect(
      slices.map((slice) => ({
        runId: slice.biocharProduct.linkedProductionRunId,
        wetTons: slice.biocharAppliedTons,
        dryTons: slice.biocharAppliedDryTons,
        sourceAllocation: slice.sourceAllocation,
      })),
    ).toEqual([
      {
        runId: "run-a",
        wetTons: 1,
        dryTons: 0.8,
        sourceAllocation: {
          productionRunId: "run-a",
          allocatedWetMassKg: 50,
          allocatedDryMassKg: 40,
        },
      },
      {
        runId: "run-b",
        wetTons: 3,
        dryTons: 1.2,
        sourceAllocation: {
          productionRunId: "run-b",
          allocatedWetMassKg: 150,
          allocatedDryMassKg: 60,
        },
      },
    ]);
    expect(
      slices.reduce((sum, slice) => sum + slice.biocharAppliedTons, 0),
    ).toBe(4);
    expect(
      slices.reduce(
        (sum, slice) => sum + (slice.biocharAppliedDryTons ?? 0),
        0,
      ),
    ).toBe(2);
  });

  it("preserves the legacy linked run when no allocations exist", () => {
    expect(
      splitApplicationAcrossSourceAllocations(application(), []),
    ).toEqual([{ ...application(), sourceAllocation: null }]);
  });
});
