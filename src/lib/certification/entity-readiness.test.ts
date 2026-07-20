import { describe, expect, it } from "vitest";
import { deriveEntityCertifyReadiness } from "./entity-readiness";
import {
  isCertifyEntityField,
  isCertifyFormField,
} from "./certify-field-registry";

describe("deriveEntityCertifyReadiness", () => {
  it.each(["failed", "cancelled"])(
    "reports only the lifecycle gap for a %s production run",
    (status) => {
      const readiness = deriveEntityCertifyReadiness("productionRun", {
        status,
        readingsCount: 0,
      });

      expect(readiness.state).toBe("incomplete");
      expect(readiness.gaps).toHaveLength(1);
      expect(readiness.gaps[0]?.kind).toBe("lifecycle");
    },
  );

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
      readingsCount: 1,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [] });
  });

  it("reports missing telemetry when a complete production run has no readings", () => {
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
      readingsCount: 0,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps).toMatchObject([
      {
        kind: "field",
        key: "telemetryReadings",
        label: "Telemetry readings",
      },
    ]);
  });

  it("reports missing telemetry when the reading count is omitted", () => {
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

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps).toMatchObject([
      {
        kind: "field",
        key: "telemetryReadings",
        label: "Telemetry readings",
      },
    ]);
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
      readingsCount: 1,
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
      readingsCount: 1,
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
      readingsCount: 1,
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
      "sReflectanceFraction",
    ]);
  });

  it("accepts either reactive or residual carbon for 1000-year samples", () => {
    const readiness = deriveEntityCertifyReadiness("sample", {
      durabilityOption: "1000_year",
      organicCarbonPercent: 80,
      hToCOrgRatio: 0.4,
      randomReflectanceR0Percent: 1.2,
      sReflectanceFraction: 0.85,
      reactiveCarbonPercent: null,
      residualCarbonPercent: 85,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [] });
  });

  it("marks a complete feedstock with wet mass ready", () => {
    const readiness = deriveEntityCertifyReadiness("feedstock", {
      status: "complete",
      massWetKg: 1500,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [] });
  });

  it("reports a feedstock missing wet mass via the entity column", () => {
    const readiness = deriveEntityCertifyReadiness("feedstock", {
      status: "complete",
      massWetKg: null,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps).toMatchObject([
      { kind: "field", key: "massWetKg", fields: ["massWetKg"] },
    ]);
  });

  it("reports an upcoming delivery as a lifecycle gap", () => {
    const readiness = deriveEntityCertifyReadiness("delivery", {
      status: "upcoming",
      deliveredWetMassKg: 400,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps).toMatchObject([
      { kind: "lifecycle", key: "lifecycleState", fields: ["status"] },
    ]);
  });

  it("accepts a delivered delivery without a lifecycle gap", () => {
    const readiness = deriveEntityCertifyReadiness("delivery", {
      status: "delivered",
      deliveredWetMassKg: 400,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [] });
  });

  it("marks an application with complete visual evidence ready", () => {
    const readiness = deriveEntityCertifyReadiness("application", {
      biocharAppliedTons: 10,
      biocharAppliedDryTons: 8,
      durabilityOption: "200_year",
      soilTemperatureC: 15,
      evidenceGapCount: 0,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [] });
  });

  it("reports missing visual evidence roles for an application", () => {
    const readiness = deriveEntityCertifyReadiness("application", {
      biocharAppliedTons: 10,
      biocharAppliedDryTons: 8,
      durabilityOption: "200_year",
      soilTemperatureC: 15,
      evidenceGapCount: 3,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps).toMatchObject([
      {
        kind: "field",
        key: "applicationEvidence",
        label: "Application evidence",
      },
    ]);
  });

  it("fails closed when an application row omits its evidence gap count", () => {
    const readiness = deriveEntityCertifyReadiness("application", {
      biocharAppliedTons: 10,
      biocharAppliedDryTons: 8,
      durabilityOption: "200_year",
      soilTemperatureC: 15,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps).toMatchObject([
      {
        kind: "field",
        key: "applicationEvidence",
        label: "Application evidence",
      },
    ]);
  });
});

describe("isCertifyFormField", () => {
  it("badges entered descriptors by their key", () => {
    expect(isCertifyFormField("delivery", "deliveredWetMassKg")).toBe(true);
    expect(isCertifyFormField("application", "soilTemperatureC")).toBe(true);
    expect(isCertifyFormField("customerLocation", "distanceFromFacilityKm")).toBe(true);
  });

  it("badges via formFields when the form name differs from the column", () => {
    expect(isCertifyFormField("feedstock", "totalWetMassKg")).toBe(true);
    expect(isCertifyFormField("feedstock", "massWetKg")).toBe(false);
  });

  it("badges derived descriptors only through explicit formFields", () => {
    expect(isCertifyFormField("feedstock", "transportDistanceKm")).toBe(true);
    expect(isCertifyFormField("feedstock", "transportLeg")).toBe(false);
  });

  it("ignores fields outside the registry", () => {
    expect(isCertifyFormField("delivery", "distanceKmOverride")).toBe(false);
  });
});

describe("isCertifyEntityField", () => {
  it("badges persisted fields used by read-only detail surfaces", () => {
    expect(isCertifyEntityField("feedstock", "massWetKg")).toBe(true);
    expect(isCertifyEntityField("feedstock", "totalWetMassKg")).toBe(true);
    expect(isCertifyEntityField("delivery", "deliveredWetMassKg")).toBe(true);
  });

  it("ignores non-certification detail fields", () => {
    expect(isCertifyEntityField("delivery", "distanceKmOverride")).toBe(false);
    expect(isCertifyEntityField("feedstock", "notes")).toBe(false);
  });
});
