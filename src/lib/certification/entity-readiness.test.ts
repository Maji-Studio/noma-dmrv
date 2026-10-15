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
      moistureContentPercent: 10,
      sampling: "sampled",
      durabilityOption: "200_year",
      totalCarbonPercent: 82,
      inorganicCarbonPercent: 2,
      organicCarbonPercent: 80,
      hToCOrgRatio: 0.4,
      oToCOrgRatio: 0.15,
      randomReflectanceR0Percent: null,
      reactiveCarbonPercent: null,
      residualCarbonPercent: null,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  // Soil Module §3.3 Table 2 checks pooled H/C_org AND O/C_org on every tier.
  // Both ratios are required on sampled batches, so a Sample carrying
  // only H:Corg must not badge complete — it never counts toward the §8.3.1
  // usable-replicate minimum (QA 2026-07-25 F-6).
  // durability-submission-gates.ts skips unsampled batches and their chemistry.
  it.each(["200_year", "1000_year"])(
    "reports the O:Corg gap for a %s sample missing the oxygen ratio",
    (durabilityOption) => {
      const readiness = deriveEntityCertifyReadiness("sample", {
        moistureContentPercent: 10,
        sampling: "sampled",
        durabilityOption,
        totalCarbonPercent: 82,
        inorganicCarbonPercent: 2,
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

  it("requires sReflectanceFraction for a sampled 1000-year Sample", () => {
    const readiness = deriveEntityCertifyReadiness("sample", {
      moistureContentPercent: 10,
      sampling: "sampled",
      durabilityOption: "1000_year",
      totalCarbonPercent: 82,
      inorganicCarbonPercent: 2,
      organicCarbonPercent: 80,
      hToCOrgRatio: 0.4,
      oToCOrgRatio: 0.15,
      randomReflectanceR0Percent: null,
      reactiveCarbonPercent: null,
      residualCarbonPercent: null,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps.map((gap) => gap.key)).toEqual([
      "sReflectanceFraction",
    ]);
  });

  it("reports paired carbon gaps for a sampled 1000-year Sample", () => {
    const readiness = deriveEntityCertifyReadiness("sample", {
      moistureContentPercent: 10,
      sampling: "sampled",
      durabilityOption: "1000_year",
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

  it("marks a sampled 1000-year Sample ready when all required inputs are present", () => {
    const readiness = deriveEntityCertifyReadiness("sample", {
      moistureContentPercent: 10,
      sampling: "sampled",
      durabilityOption: "1000_year",
      totalCarbonPercent: 82,
      inorganicCarbonPercent: 2,
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

  it.each([null, undefined])("keeps chemistry gaps without replicate gaps when sampling is %s", (sampling) => {
    for (const durabilityOption of ["200_year", "1000_year"]) {
      const readiness = deriveEntityCertifyReadiness("sample", {
        moistureContentPercent: 10,
        sampling,
        durabilityOption,
        randomReflectanceR0Percent: 1.2,
        residualCarbonPercent: 85,
      });
      expect(readiness.state).toBe("incomplete");
      expect(readiness.gaps.map((gap) => gap.key)).toEqual([
        "organicCarbonPercent", "hToCOrgRatio", "oToCOrgRatio",
      ]);
    }
  });

  it.each(["200_year", "1000_year"])("skips chemistry only for an explicitly unsampled %s batch", (durabilityOption) => {
    expect(deriveEntityCertifyReadiness("sample", {
      moistureContentPercent: 10,
      sampling: "unsampled", durabilityOption,
      randomReflectanceR0Percent: 1.2, residualCarbonPercent: 85,
    })).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("marks a complete feedstock with wet mass ready", () => {
    const readiness = deriveEntityCertifyReadiness("feedstock", {
      status: "complete",
      massWetKg: 1500,
      transportDistanceKm: 25,
      hasUsableTransportLeg: true,
      transportDistanceSource: "document",
      transportEvidenceDocumentCount: 1,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("does not repeat the wet mass save rule as a certification gap", () => {
    const readiness = deriveEntityCertifyReadiness("feedstock", {
      status: "complete",
      massWetKg: null,
      transportDistanceKm: 25,
      hasUsableTransportLeg: true,
      transportDistanceSource: "document",
      transportEvidenceDocumentCount: 1,
    });

    expect(readiness.state).toBe("ready");
    expect(readiness.gaps).toEqual([]);
  });

  it("accepts manual provenance when feedstock evidence is present", () => {
    const readiness = deriveEntityCertifyReadiness("feedstock", {
      status: "complete",
      massWetKg: 1500,
      transportDistanceKm: 25,
      hasUsableTransportLeg: true,
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
      proofOfDeliveryCount: 1,
      status: "upcoming",
      deliveredWetMassKg: 400,
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
      proofOfDeliveryCount: 1,
      status: "delivered",
      deliveredWetMassKg: 400,
      effectiveDistanceSource: "document",
      transportEvidenceDocumentCount: 1,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("keeps a delivered delivery ready with its physical wet mass", () => {
    const readiness = deriveEntityCertifyReadiness("delivery", {
      proofOfDeliveryCount: 1,
      status: "delivered",
      deliveredWetMassKg: 400,
    });

    expect(readiness).toEqual({ state: "ready", gaps: [], warnings: [] });
  });

  it("blocks a delivered delivery without proof", () => {
    const readiness = deriveEntityCertifyReadiness("delivery", {
      proofOfDeliveryCount: 0,
      status: "delivered",
      deliveredWetMassKg: 400,
      effectiveDistanceSource: "manual",
      transportEvidenceDocumentCount: 0,
    });

    expect(readiness.state).toBe("incomplete");
    expect(readiness.gaps).toMatchObject([{ key: "proofOfDelivery" }]);
  });

  it.each([
    [
      "feedstock",
      {
        status: "complete",
        massWetKg: 1500,
        transportDistanceKm: 25,
      hasUsableTransportLeg: true,
        transportDistanceSource: "manual",
        transportEvidenceDocumentCount: 0,
      },
    ],
    [
      "delivery",
      {
        status: "delivered",
        proofOfDeliveryCount: 1,
        deliveredWetMassKg: 400,
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
  it.each(["sampled", "unsampled", null, undefined])("shares Sample conditions with read fields when sampling is %s", (sampling) => {
    for (const durabilityOption of ["200_year", "1000_year"]) {
      const context = { sampling, durabilityOption };
      const chemistryRequired = sampling !== "unsampled";
      for (const field of ["organicCarbonPercent", "hToCOrgRatio", "totalHydrogenPercent", "oToCOrgRatio"]) {
        expect(isCertifyFormField("sample", field, context), field).toBe(chemistryRequired);
        expect(isCertifyEntityField("sample", field, context), field).toBe(chemistryRequired);
      }
      for (const field of ["totalCarbonPercent", "inorganicCarbonPercent", "sReflectanceFraction"]) {
        const required = sampling === "sampled" && durabilityOption === "1000_year";
        expect(isCertifyFormField("sample", field, context), field).toBe(required);
        expect(isCertifyEntityField("sample", field, context), field).toBe(required);
      }
      for (const field of ["randomReflectanceR0Percent", "reactiveCarbonPercent", "residualCarbonPercent"]) {
        expect(isCertifyFormField("sample", field, context), field).toBe(false);
        expect(isCertifyEntityField("sample", field, context), field).toBe(false);
      }
    }
  });

  it("badges entered descriptors by their key", () => {
    expect(isCertifyFormField("delivery", "deliveredWetMassKg")).toBe(true);
    expect(isCertifyFormField("application", "soilTemperatureC")).toBe(false);
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

  it("does not badge the required intake mass", () => {
    expect(isCertifyFormField("feedstock", "totalWetMassKg")).toBe(false);
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
    expect(isCertifyEntityField("feedstock", "massWetKg")).toBe(false);
    expect(isCertifyEntityField("feedstock", "totalWetMassKg")).toBe(false);
    expect(isCertifyEntityField("delivery", "deliveredWetMassKg")).toBe(true);
  });

  it("ignores non-certification detail fields", () => {
    expect(isCertifyEntityField("delivery", "distanceKmOverride")).toBe(false);
    expect(isCertifyEntityField("feedstock", "notes")).toBe(false);
  });
});


describe("non-walked entity copy", () => {
  it("treats a missing 200-year site temperature as advisory", () => {
    const result = deriveEntityCertifyReadiness("application", { biocharAppliedTons: 1, durabilityOption: "200_year", soilTemperatureC: null });
    expect(result.state).toBe("ready");
    expect(result.gaps).toEqual([]);
    expect(result.warnings).toContainEqual(expect.objectContaining({ key: "soilTemperatureC", detail: expect.stringContaining("facility reference") }));
  });
  it.each(["feedstock", "delivery", "application", "supplier", "supplierLocation", "customerLocation"] as const)("does not claim %s fields block certification", (kind) => {
    const result = deriveEntityCertifyReadiness(kind, {});
    expect(result.gaps.map((gap) => gap.detail).join(" ")).not.toContain("to certify");
  });
});


describe("feedstock transport usability", () => {
  it.each([0, -1, NaN, Infinity, null])("keeps unusable distance %s incomplete", (transportDistanceKm) => {
    const readiness = deriveEntityCertifyReadiness("feedstock", {
      status: "complete", massWetKg: 100, transportDistanceKm,
      hasUsableTransportLeg: false,
      transportDistanceSource: "manual",
    });
    expect(readiness.gaps).toContainEqual(expect.objectContaining({ key: "transportLeg" }));
  });
});

it("gives a concrete next action for a missing feedstock transport leg", () => {
  const readiness = deriveEntityCertifyReadiness("feedstock", { status: "complete", massWetKg: 100 });
  expect(readiness.gaps.find((gap) => gap.key === "transportLeg")?.detail)
    .toBe("Record a transport leg with a positive distance and load mass");
});
