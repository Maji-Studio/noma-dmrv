import { recordApplicationInput, updateApplicationInput } from "@/schemas/application-input";
import { TEST_GIS_BOUNDARY } from "./helpers/application-evidence-fixtures";
import { describe, expect, it } from "vitest";
import {
  applicationEvidenceStateSchema,
  applicationFormSchema,
} from "@/schemas/applications";
import {
  MASS_INPUT_MAX_KG,
  MASS_KG_INPUT_STEP,
  MASS_MAX_KG_MESSAGE,
  MASS_MIN_KG_MESSAGE,
} from "@/schemas/helpers";

describe("application schemas", () => {
  const customerLocation = {
    fieldSizeHa: 1,
    gpsLatitude: -3.3349,
    gpsLongitude: 37.3404,
  };

  it("defaults to customer location when a coordinate pair is supplied", () => {
    const result = applicationFormSchema.parse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedKg: 100,
      ...customerLocation,
    });

    expect(result.evidenceMethod).toBe("location");
  });

  it("requires coordinates for customer location evidence", () => {
    const result = applicationFormSchema.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedKg: 100,
      fieldSizeHa: 1,
      evidenceMethod: "location",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["gpsLatitude"],
            message: "Customer location coordinates are required.",
          }),
        ]),
      );
    }
  });

  it("allows GIS and visual alternatives without coordinates", () => {
    const base = {
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedKg: 100,
      fieldSizeHa: 1,
    };

    expect(
      applicationFormSchema.safeParse({ ...base, evidenceMethod: "boundary", gisBoundary: TEST_GIS_BOUNDARY })
        .success,
    ).toBe(true);
    expect(
      applicationFormSchema.safeParse({ ...base, evidenceMethod: "visual" })
        .success,
    ).toBe(true);
  });

  // A mass below one gram divides into a `numeric(14,6)` tonnes column as a
  // stored zero, so the floor is the storage quantum, not a bare `> 0`.
  it.each([
    { label: "zero", value: 0 },
    { label: "a sub-gram value", value: MASS_KG_INPUT_STEP / 10 },
  ])("rejects $label applied mass on the form schema", ({ value }) => {
    const result = applicationFormSchema.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedKg: value,
      ...customerLocation,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["biocharAppliedKg"],
            message: MASS_MIN_KG_MESSAGE,
          }),
        ]),
      );
    }
  });

  it("accepts the smallest storable applied mass on the form schema", () => {
    expect(
      applicationFormSchema.safeParse({
        applicationDate: new Date("2026-06-13"),
        deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        biocharAppliedKg: MASS_KG_INPUT_STEP,
        ...customerLocation,
      }).success,
    ).toBe(true);
  });

  it("rejects a zero-hectare field on the client form schema", () => {
    const result = applicationFormSchema.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedKg: 100,
      ...customerLocation,
      fieldSizeHa: 0,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.find((issue) => issue.path[0] === "fieldSizeHa")
        ?.message,
    ).toBe("Field size must be greater than 0");
  });

  it("rejects a zero-hectare field at the create server boundary", () => {
    expect(
      recordApplicationInput.safeParse({
        applicationDate: new Date("2026-06-13"),
        deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        appliedWetMassKg: 1,
        ...customerLocation,
        fieldSizeHa: 0,
      }).success,
    ).toBe(false);
  });

  it("requires a field size on the client form and create server boundary", () => {
    const input = {
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      appliedWetMassKg: 1,
      gpsLatitude: customerLocation.gpsLatitude,
      gpsLongitude: customerLocation.gpsLongitude,
    };

    expect(applicationFormSchema.safeParse({ ...input, biocharAppliedKg: input.appliedWetMassKg }).success).toBe(false);
    expect(recordApplicationInput.safeParse(input).success).toBe(false);
  });

  it("rejects a zero-hectare field at the update server boundary", () => {
    expect(
      updateApplicationInput.safeParse({ expectedVersion: 1,
        applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        fieldSizeHa: 0,
      }).success,
    ).toBe(false);
  });

  it.each([
    { label: "zero", value: 0 },
    { label: "a sub-gram value", value: MASS_KG_INPUT_STEP / 10 },
  ])("rejects $label applied mass on the create schema", ({ value }) => {
    const result = recordApplicationInput.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      appliedWetMassKg: value,
      ...customerLocation,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["appliedWetMassKg"],
            message: MASS_MIN_KG_MESSAGE,
          }),
        ]),
      );
    }
  });

  it("accepts the smallest storable applied mass on the create schema", () => {
    expect(
      recordApplicationInput.safeParse({
        applicationDate: new Date("2026-06-13"),
        deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        appliedWetMassKg: MASS_KG_INPUT_STEP,
        ...customerLocation,
      }).success,
    ).toBe(true);
  });

  it("rejects a below-quantum applied mass on the update action but allows omitting it", () => {
    for (const value of [0, MASS_KG_INPUT_STEP / 10]) {
      const result = updateApplicationInput.safeParse({ expectedVersion: 1,
        applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        appliedWetMassKg: value,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ["appliedWetMassKg"],
              message: MASS_MIN_KG_MESSAGE,
            }),
          ]),
        );
      }
    }

    expect(
      updateApplicationInput.safeParse({ expectedVersion: 1,
        applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        cropType: "Maize",
      }).success,
    ).toBe(true);
  });

  it("rejects a create payload with only one GPS coordinate", () => {
    const result = recordApplicationInput.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      appliedWetMassKg: 1,
      fieldSizeHa: 1,
      gpsLatitude: -3.3349,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["gpsLatitude"],
            message: "Longitude is required when a latitude is entered.",
          }),
        ]),
      );
    }
  });

  it("allows clearing both GPS coordinates through the update action", () => {
    const result = updateApplicationInput.safeParse({ expectedVersion: 1,
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      gpsLatitude: null,
      gpsLongitude: null,
    });

    expect(result.success).toBe(true);
  });

  it("allows a partial coordinate payload before it is merged with saved state", () => {
    const result = updateApplicationInput.safeParse({ expectedVersion: 1,
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      gpsLatitude: null,
    });

    expect(result.success).toBe(true);
  });

  it("validates the merged evidence state for partial updates", () => {
    expect(
      applicationEvidenceStateSchema.safeParse({
        evidenceMethod: "location",
        gpsLatitude: null,
        gpsLongitude: null,
      }).success,
    ).toBe(false);
    expect(
      applicationEvidenceStateSchema.safeParse({
        evidenceMethod: "boundary",
        gisBoundary: TEST_GIS_BOUNDARY,
        gpsLatitude: null,
        gpsLongitude: null,
      }).success,
    ).toBe(true);
  });

  it("rejects submitted dry biochar at operation boundaries so the server remains authoritative", () => {
    const createResult = recordApplicationInput.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      appliedWetMassKg: 100,
      biocharAppliedDryTons: 1,
      ...customerLocation,
    });
    const updateResult = updateApplicationInput.safeParse({ expectedVersion: 1,
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      appliedWetMassKg: 0.1,
      biocharAppliedDryTons: 0,
    });
    const formResult = applicationFormSchema.parse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedKg: 100,
      biocharAppliedDryTons: 1,
      ...customerLocation,
    });

    expect(createResult.success).toBe(false);
    expect(updateResult.success).toBe(false);
    expect(formResult).not.toHaveProperty("biocharAppliedDryTons");
  });

  it("uses kilogram bounds and copy for client form mass fields", () => {
    const base = {
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      ...customerLocation,
    };

    expect(applicationFormSchema.safeParse({
      ...base,
      biocharAppliedKg: MASS_INPUT_MAX_KG,
    }).success).toBe(true);
    const result = applicationFormSchema.safeParse({
      ...base,
      biocharAppliedKg: MASS_INPUT_MAX_KG + 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["biocharAppliedKg"],
            message: MASS_MAX_KG_MESSAGE,
          }),
        ]),
      );
    }
  });

  it("uses kilogram bounds for the create action payload", () => {
    const base = {
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      ...customerLocation,
    };

    expect(recordApplicationInput.safeParse({
      ...base,
      appliedWetMassKg: MASS_INPUT_MAX_KG,
    }).success).toBe(true);
    const result = recordApplicationInput.safeParse({
      ...base,
      appliedWetMassKg: MASS_INPUT_MAX_KG + 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["appliedWetMassKg"],
            message: MASS_MAX_KG_MESSAGE,
          }),
        ]),
      );
    }
  });
});
