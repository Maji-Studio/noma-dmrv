import { describe, expect, it } from "vitest";
import type { CreditBatch } from "@/db/schema";
import {
  splitApplicationAcrossSourceAllocations,
} from "./biochar-product-application-allocation";
import {
  buildCo2eStoredPreview,
  type BatchLineageApplicationFact,
  type CreditBatchChemistry,
  type CreditBatchLineageFacts,
} from "./credit-batch-accounting";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "@/lib/isometric/transformers/measurement-sample";
import { CURRENT_1000_YEAR_PREVIEW_FORMULA_VERSION } from "@/lib/calculations/biochar-removal";
import { STORED_CO2E_PREVIEW_REVERIFICATION_GAP } from "@/lib/certification/preview-gaps";

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

const batch = (durabilityOption: "200_year" | "1000_year") =>
  ({
    id: "batch-1",
    code: "CB-1",
    durabilityOption,
    sampling: "sampled",
  }) as CreditBatch & { durabilityOption: "200_year" | "1000_year" };

const facts: CreditBatchLineageFacts = {
  batchId: "batch-1",
  productionRunIds: [],
  runs: [],
  applications: [],
  applicationIds: [],
  appliedWeightTons: 0,
};

const chemistry: CreditBatchChemistry = {
  weightedHToCorgRatio: null,
  weightedOrganicCarbonPercent: null,
  weightedOToCorgRatio: null,
  weightedAshPercent: null,
  weightedMoisturePercent: null,
  blueprint1000YearReplicates: [],
  blueprint1000YearInputsComplete: false,
};

describe("buildCo2eStoredPreview", () => {
  it("keeps the independently versioned 1000-year preview available", () => {
    const preview = buildCo2eStoredPreview(
      batch("1000_year"),
      "isometric",
      facts,
      chemistry,
    );

    expect(preview.componentKey).toBe(
      CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
    );
    expect(preview.formulaVersion).toBe(
      CURRENT_1000_YEAR_PREVIEW_FORMULA_VERSION,
    );
    expect(preview.missingInputs).not.toContain(
      STORED_CO2E_PREVIEW_REVERIFICATION_GAP,
    );
  });

  it("retains the module re-verification gate for 200-year previews", () => {
    const preview = buildCo2eStoredPreview(
      batch("200_year"),
      "isometric",
      facts,
      chemistry,
    );
    expect(preview.missingInputs).toEqual([
      STORED_CO2E_PREVIEW_REVERIFICATION_GAP,
    ]);
  });
});
