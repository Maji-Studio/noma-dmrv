import { describe, expect, it } from "vitest";
import { deriveEntityCertifyReadiness } from "./entity-readiness";
import {
  isCertifyEntityField,
  isCertifyFormField,
} from "./certify-field-registry";

const DELIVERY_TRUCK_MASS_ON_ARRIVAL_KG = 1_400;
const DELIVERY_TRUCK_MASS_ON_DEPARTURE_KG = 1_000;

describe("deriveEntityCertifyReadiness", () => {
  it.each(["failed", "cancelled"])(
    "reports only the lifecycle gap for a %s production run",
    (status) => {
      const readiness = deriveEntityCertifyReadiness("productionRun", {
        status,
      });

      expect(readiness.state).toBe("incomplete");
      expect(readiness.gaps).toHaveLength(1);
      expect(readiness.gaps[0]?.kind).toBe("lifecycle");
    },
  );

  it("marks a complete production run ready", () => {
    const readiness = deriveEntityCertifyReadiness("productionRun", {
      status: "complete",
      hasReadingsFile: true,
      feedstockWetMassKg: 5000,
      feedstockMoisturePercent: 25,
      biocharOutputKg: 1500,
      biocharMoisturePercent: 10,
      dieselOperationLiters: 0,
      dieselGensetLiters: 12,
      preprocessingFuelLiters: 3,
      electricityKwh: 50,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("uses the uploaded readings-file fact instead of legacy telemetry rows", () => {
    const readiness = deriveEntityCertifyReadiness("productionRun", {
      status: "complete",
      hasReadingsFile: true,
      feedstockWetMassKg: 5000,
      feedstockMoisturePercent: 25,
      biocharOutputKg: 1500,
      biocharMoisturePercent: 10,
      dieselOperationLiters: 0,
      dieselGensetLiters: 12,
      preprocessingFuelLiters: 3,
      electricityKwh: 50,
      // Legacy telemetry key: the removed gate must stay gone, so a zero count
      // must not produce a gap.
      readingsCount: 0,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it.each([false, undefined])(
    "requires saved uploaded readings evidence when hasReadingsFile is %s",
    (hasReadingsFile) => {
      const readiness = deriveEntityCertifyReadiness("productionRun", {
        status: "complete",
        hasReadingsFile,
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
          key: "hasReadingsFile",
          label: "Readings CSV file",
          fields: ["hasReadingsFile"],
        },
      ]);
    },
  );

  it("reports missing entered fields", () => {
    const readiness = deriveEntityCertifyReadiness("productionRun", {
      status: "complete",
      hasReadingsFile: true,
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
      hasReadingsFile: true,
      feedstockWetMassKg: 5000,
      feedstockMoisturePercent: 0,
      biocharOutputKg: 1500,
      biocharMoisturePercent: 0,
      dieselOperationLiters: 0,
      dieselGensetLiters: 0,
      preprocessingFuelLiters: 0,
      electricityKwh: 0,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("requires terminal lifecycle state where configured", () => {
    const readiness = deriveEntityCertifyReadiness("productionRun", {
      status: "running",
      hasReadingsFile: true,
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
      oToCOrgRatio: 0.15,
      randomReflectanceR0Percent: null,
      reactiveCarbonPercent: null,
      residualCarbonPercent: null,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  // Both eligibility ratios are universal (§3.3 Table 2), so a sample carrying
  // only H:Corg must not badge complete — it never counts toward the §8.3.1
  // usable-replicate minimum (QA 2026-07-25 F-6).
  it.each(["200_year", "1000_year"])(
    "reports the O:Corg gap for a %s sample missing the oxygen ratio",
    (durabilityOption) => {
      const readiness = deriveEntityCertifyReadiness("sample", {
        durabilityOption,
        organicCarbonPercent: 80,
        hToCOrgRatio: 0.4,
        oToCOrgRatio: null,
        randomReflectanceR0Percent: 1.2,
        sReflectanceFraction: 0.85,
        reactiveCarbonPercent: null,
        residualCarbonPercent: 85,
      });

      expect(readiness.state).toBe("incomplete");
      expect(readiness.gaps).toMatchObject([
        {
          kind: "field",
          key: "oToCOrgRatio",
          label: "O:Corg ratio",
          fields: ["oToCOrgRatio"],
        },
      ]);
    },
  );

  it("requires 1000-year durability fields when the condition applies", () => {
    const readiness = deriveEntityCertifyReadiness("sample", {
      durabilityOption: "1000_year",
      organicCarbonPercent: 80,
      hToCOrgRatio: 0.4,
      oToCOrgRatio: 0.15,
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

  it("reports paired carbon gaps for a sampled 1000-year Sample", () => {
    const readiness = deriveEntityCertifyReadiness("sample", {
      durabilityOption: "1000_year",
      sampling: "sampled",
      totalCarbonPercent: null,
      inorganicCarbonPercent: null,
      organicCarbonPercent: 80,
      hToCOrgRatio: 0.4,
      oToCOrgRatio: 0.15,
      randomReflectanceR0Percent: 1.2,
      sReflectanceFraction: 0.85,
      reactiveCarbonPercent: null,
      residualCarbonPercent: 85,
    });

    expect(readiness.gaps.map((gap) => gap.key)).toEqual([
      "totalCarbonPercent",
      "inorganicCarbonPercent",
    ]);
  });

  it("accepts either reactive or residual carbon for 1000-year samples", () => {
    const readiness = deriveEntityCertifyReadiness("sample", {
      durabilityOption: "1000_year",
      organicCarbonPercent: 80,
      hToCOrgRatio: 0.4,
      oToCOrgRatio: 0.15,
      randomReflectanceR0Percent: 1.2,
      sReflectanceFraction: 0.85,
      reactiveCarbonPercent: null,
      residualCarbonPercent: 85,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("marks a complete feedstock with wet mass ready", () => {
    const readiness = deriveEntityCertifyReadiness("feedstock", {
      status: "complete",
      massWetKg: 1500,
      transportDistanceKm: 25,
      transportDistanceSource: "document",
      transportEvidenceDocumentCount: 1,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("reports a feedstock missing wet mass via the entity column", () => {
    const readiness = deriveEntityCertifyReadiness("feedstock", {
      status: "complete",
      massWetKg: null,
      transportDistanceKm: 25,
      transportDistanceSource: "document",
      transportEvidenceDocumentCount: 1,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps).toMatchObject([
      { kind: "field", key: "massWetKg", fields: ["massWetKg"] },
    ]);
  });

  it("accepts manual provenance when feedstock evidence is present", () => {
    const readiness = deriveEntityCertifyReadiness("feedstock", {
      status: "complete",
      massWetKg: 1500,
      transportDistanceKm: 25,
      transportDistanceSource: "manual",
      transportEvidenceDocumentCount: 1,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("marks a document-backed transport leg ready", () => {
    const readiness = deriveEntityCertifyReadiness("transportLeg", {
      distanceKm: 25,
      loadMassKg: 900,
      distanceSource: "document",
      transportEvidenceDocumentCount: 1,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("keeps a transport leg ready without an accepted upload", () => {
    const readiness = deriveEntityCertifyReadiness("transportLeg", {
      distanceKm: 25,
      loadMassKg: 900,
      distanceSource: "document",
      transportEvidenceDocumentCount: 0,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("keeps a transport leg ready when its evidence count is omitted", () => {
    const readiness = deriveEntityCertifyReadiness("transportLeg", {
      distanceKm: 25,
      loadMassKg: 900,
      distanceSource: "document",
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("accepts manual-provenance transport evidence", () => {
    const readiness = deriveEntityCertifyReadiness("transportLeg", {
      distanceKm: 25,
      loadMassKg: 900,
      distanceSource: "manual",
      transportEvidenceDocumentCount: 2,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("keeps a transport leg ready without a recorded distance source", () => {
    const readiness = deriveEntityCertifyReadiness("transportLeg", {
      distanceKm: 25,
      loadMassKg: 900,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("reports an upcoming delivery as a lifecycle gap", () => {
    const readiness = deriveEntityCertifyReadiness("delivery", {
      status: "upcoming",
      deliveredWetMassKg: 400,
      truckMassOnArrivalKg: DELIVERY_TRUCK_MASS_ON_ARRIVAL_KG,
      truckMassOnDepartureKg: DELIVERY_TRUCK_MASS_ON_DEPARTURE_KG,
      effectiveDistanceSource: "document",
      transportEvidenceDocumentCount: 1,
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
      truckMassOnArrivalKg: DELIVERY_TRUCK_MASS_ON_ARRIVAL_KG,
      truckMassOnDepartureKg: DELIVERY_TRUCK_MASS_ON_DEPARTURE_KG,
      effectiveDistanceSource: "document",
      transportEvidenceDocumentCount: 1,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("keeps a delivered delivery ready without evidence", () => {
    const readiness = deriveEntityCertifyReadiness("delivery", {
      status: "delivered",
      deliveredWetMassKg: 400,
      truckMassOnArrivalKg: DELIVERY_TRUCK_MASS_ON_ARRIVAL_KG,
      truckMassOnDepartureKg: DELIVERY_TRUCK_MASS_ON_DEPARTURE_KG,
      effectiveDistanceSource: "manual",
      transportEvidenceDocumentCount: 0,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it.each([
    [
      "feedstock",
      {
        status: "complete",
        massWetKg: 1500,
        transportDistanceKm: 25,
        transportDistanceSource: "manual",
        transportEvidenceDocumentCount: 0,
      },
    ],
    [
      "delivery",
      {
        status: "delivered",
        deliveredWetMassKg: 400,
        truckMassOnArrivalKg: DELIVERY_TRUCK_MASS_ON_ARRIVAL_KG,
        truckMassOnDepartureKg: DELIVERY_TRUCK_MASS_ON_DEPARTURE_KG,
        effectiveDistanceSource: "manual",
        transportEvidenceDocumentCount: 0,
      },
    ],
    [
      "transportLeg",
      {
        distanceKm: 25,
        loadMassKg: 900,
        distanceSource: "manual",
        transportEvidenceDocumentCount: 0,
      },
    ],
  ] as const)(
    "does not create a transport gap for a complete %s with no documents",
    (entityKind, entity) => {
      expect(deriveEntityCertifyReadiness(entityKind, entity)).toEqual({
        state: "ready",
        gaps: [],
        warnings: [],
      });
    },
  );

  it("marks an application with complete visual evidence ready", () => {
    const readiness = deriveEntityCertifyReadiness("application", {
      biocharAppliedTons: 10,
      biocharAppliedDryTons: 8,
      durabilityOption: "200_year",
      soilTemperatureC: 15,
      evidenceGapCount: 0,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("does not treat application evidence health as certification readiness", () => {
    const readiness = deriveEntityCertifyReadiness("application", {
      biocharAppliedTons: 10,
      biocharAppliedDryTons: 8,
      durabilityOption: "200_year",
      soilTemperatureC: 15,
      evidenceGapCount: 3,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("does not require an application evidence count for certification", () => {
    const readiness = deriveEntityCertifyReadiness("application", {
      biocharAppliedTons: 10,
      biocharAppliedDryTons: 8,
      durabilityOption: "200_year",
      soilTemperatureC: 15,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });
});

describe("isCertifyFormField", () => {
  it("badges entered descriptors by their key", () => {
    expect(isCertifyFormField("delivery", "deliveredWetMassKg")).toBe(true);
    expect(isCertifyFormField("application", "soilTemperatureC")).toBe(true);
    expect(isCertifyFormField("customerLocation", "distanceFromFacilityKm")).toBe(true);
  });

  it.each([
    "totalHydrogenPercent",
    "organicCarbonPercent",
    "hToCOrgRatio",
  ])("badges sample H:Corg form field %s", (field) => {
    expect(isCertifyFormField("sample", field)).toBe(true);
  });

  it("badges the readings upload through its form field name", () => {
    expect(isCertifyFormField("productionRun", "readingsCsv")).toBe(true);
    expect(isCertifyEntityField("productionRun", "hasReadingsFile")).toBe(true);
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
