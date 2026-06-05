import { describe, expect, it } from "vitest";
import { deriveEntityCertifyReadiness } from "./entity-readiness";

describe("deriveEntityCertifyReadiness", () => {
  it("marks a complete production run ready", () => {
    const readiness = deriveEntityCertifyReadiness("productionRun", {
      status: "complete",
      feedstockWetMassKg: 5000,
      feedstockMoisturePercent: 25,
      biocharOutputKg: 1500,
      biocharMoisturePercent: 10,
      dieselOperationLiters: 0,
      dieselGensetLiters: 12,
      preprocessingFuelLiters: 3,
      electricityKwh: 50,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [] });
  });

  it("reports missing entered fields", () => {
    const readiness = deriveEntityCertifyReadiness("productionRun", {
      status: "complete",
      feedstockWetMassKg: 5000,
      feedstockMoisturePercent: 25,
      biocharOutputKg: 1500,
      biocharMoisturePercent: 10,
      dieselOperationLiters: 0,
      dieselGensetLiters: 12,
      preprocessingFuelLiters: 3,
      electricityKwh: null,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps).toMatchObject([
      {
        kind: "field",
        key: "electricityKwh",
        fields: ["electricityKwh"],
      },
    ]);
  });

  it("treats zero as present", () => {
    const readiness = deriveEntityCertifyReadiness("productionRun", {
      status: "complete",
      feedstockWetMassKg: 5000,
      feedstockMoisturePercent: 0,
      biocharOutputKg: 1500,
      biocharMoisturePercent: 0,
      dieselOperationLiters: 0,
      dieselGensetLiters: 0,
      preprocessingFuelLiters: 0,
      electricityKwh: 0,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [] });
  });

  it("requires terminal lifecycle state where configured", () => {
    const readiness = deriveEntityCertifyReadiness("productionRun", {
      status: "running",
      feedstockWetMassKg: 5000,
      feedstockMoisturePercent: 25,
      biocharOutputKg: 1500,
      biocharMoisturePercent: 10,
      dieselOperationLiters: 0,
      dieselGensetLiters: 12,
      preprocessingFuelLiters: 3,
      electricityKwh: 50,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps).toMatchObject([
      {
        kind: "lifecycle",
        key: "lifecycleState",
      },
    ]);
  });

  it("does not require 1000-year durability fields for 200-year samples", () => {
    const readiness = deriveEntityCertifyReadiness("sample", {
      durabilityOption: "200_year",
      organicCarbonPercent: 80,
      hToCOrgRatio: 0.4,
      randomReflectanceR0Percent: null,
      reactiveCarbonPercent: null,
      residualCarbonPercent: null,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [] });
  });

  it("requires 1000-year durability fields when the condition applies", () => {
    const readiness = deriveEntityCertifyReadiness("sample", {
      durabilityOption: "1000_year",
      organicCarbonPercent: 80,
      hToCOrgRatio: 0.4,
      randomReflectanceR0Percent: null,
      reactiveCarbonPercent: null,
      residualCarbonPercent: null,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps.map((gap) => gap.key)).toEqual([
      "tgaNonReactiveCarbonData",
      "randomReflectanceR0Percent",
    ]);
  });

  it("accepts either reactive or residual carbon for 1000-year samples", () => {
    const readiness = deriveEntityCertifyReadiness("sample", {
      durabilityOption: "1000_year",
      organicCarbonPercent: 80,
      hToCOrgRatio: 0.4,
      randomReflectanceR0Percent: 1.2,
      reactiveCarbonPercent: null,
      residualCarbonPercent: 85,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [] });
  });
});
