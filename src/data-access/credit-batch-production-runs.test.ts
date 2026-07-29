import { describe, expect, it } from "vitest";
import { SafeError } from "@/lib/errors";
import { projectApplicationsAcrossSourceAllocations } from "./credit-batch-production-runs";

const application = {
  applicationId: "application-1",
  biocharProductId: "product-1",
  linkedProductionRunId: null,
  biocharAppliedTons: 10,
};

const allocations = [
  {
    biocharProductId: "product-1",
    productionRunId: "run-a",
    allocatedWetMassKg: 25,
  },
  {
    biocharProductId: "product-1",
    productionRunId: "run-b",
    allocatedWetMassKg: 75,
  },
];

describe("projectApplicationsAcrossSourceAllocations", () => {
  it("projects applied wet mass proportionally across every source run", () => {
    expect(
      projectApplicationsAcrossSourceAllocations(
        [application],
        allocations,
        ["run-a", "run-b"],
      ),
    ).toEqual([
      {
        applicationId: "application-1",
        productionRunId: "run-a",
        biocharAppliedTons: 2.5,
      },
      {
        applicationId: "application-1",
        productionRunId: "run-b",
        biocharAppliedTons: 7.5,
      },
    ]);
  });

  it("uses all source allocations as the denominator when requesting one run", () => {
    expect(
      projectApplicationsAcrossSourceAllocations(
        [application],
        allocations,
        ["run-b"],
      ),
    ).toEqual([
      {
        applicationId: "application-1",
        productionRunId: "run-b",
        biocharAppliedTons: 7.5,
      },
    ]);
  });

  it("uses the legacy run only when the product has no allocation rows", () => {
    expect(
      projectApplicationsAcrossSourceAllocations(
        [{
          ...application,
          linkedProductionRunId: "legacy-run",
        }],
        [],
        ["legacy-run"],
      ),
    ).toEqual([
      {
        applicationId: "application-1",
        productionRunId: "legacy-run",
        biocharAppliedTons: 10,
      },
    ]);

    expect(
      projectApplicationsAcrossSourceAllocations(
        [{
          ...application,
          linkedProductionRunId: "legacy-run",
        }],
        allocations,
        ["legacy-run"],
      ),
    ).toEqual([]);
  });

  it("fails closed when positive applied mass has zero source mass", () => {
    expect(() =>
      projectApplicationsAcrossSourceAllocations(
        [application],
        allocations.map((allocation) => ({
          ...allocation,
          allocatedWetMassKg: 0,
        })),
        ["run-a", "run-b"],
      ),
    ).toThrowError(SafeError);
  });
});
