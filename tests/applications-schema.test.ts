import { describe, expect, it } from "vitest";
import {
  applicationEvidenceStateSchema,
  applicationFormSchema,
  createApplicationSchema,
  updateApplicationSchema,
} from "@/schemas/applications";
import {
  MASS_INPUT_MAX_KG,
  MASS_INPUT_MAX_TONNES,
  MASS_KG_INPUT_STEP,
  MASS_MAX_KG_MESSAGE,
  MASS_MAX_TONNES_MESSAGE,
  MASS_MIN_KG_MESSAGE,
  MASS_MIN_TONNES_MESSAGE,
  MASS_TONNES_INPUT_STEP,
} from "@/schemas/helpers";

describe("application schemas", () => {
  const customerLocation = {
    gpsLatitude: -3.3349,
    gpsLongitude: 37.3404,
  };

  it("defaults to customer location when a coordinate pair is supplied", () => {
    const result = applicationFormSchema.parse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: 100,
      ...customerLocation,
    });

    expect(result.evidenceMethod).toBe("location");
  });

  it("requires coordinates for customer location evidence", () => {
    const result = applicationFormSchema.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: 100,
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
      biocharAppliedTons: 100,
    };

    expect(
      applicationFormSchema.safeParse({ ...base, evidenceMethod: "boundary" })
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
      biocharAppliedTons: value,
      ...customerLocation,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["biocharAppliedTons"],
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
        biocharAppliedTons: MASS_KG_INPUT_STEP,
        ...customerLocation,
      }).success,
    ).toBe(true);
  });

  it("rejects a zero-hectare field on the client form schema", () => {
    const result = applicationFormSchema.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: 100,
      fieldSizeHa: 0,
      ...customerLocation,
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
      createApplicationSchema.safeParse({
        applicationDate: new Date("2026-06-13"),
        deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        biocharAppliedTons: 1,
        fieldSizeHa: 0,
        ...customerLocation,
      }).success,
    ).toBe(false);
  });

  it("rejects a zero-hectare field at the update server boundary", () => {
    expect(
      updateApplicationSchema.safeParse({
        applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        fieldSizeHa: 0,
      }).success,
    ).toBe(false);
  });

  it.each([
    { label: "zero", value: 0 },
    { label: "a sub-gram value", value: MASS_TONNES_INPUT_STEP / 10 },
  ])("rejects $label applied mass on the create schema", ({ value }) => {
    const result = createApplicationSchema.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: value,
      ...customerLocation,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["biocharAppliedTons"],
            message: MASS_MIN_TONNES_MESSAGE,
          }),
        ]),
      );
    }
  });

  it("accepts the smallest storable applied mass on the create schema", () => {
    expect(
      createApplicationSchema.safeParse({
        applicationDate: new Date("2026-06-13"),
        deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        biocharAppliedTons: MASS_TONNES_INPUT_STEP,
        ...customerLocation,
      }).success,
    ).toBe(true);
  });

  it("rejects a below-quantum applied mass on the update action but allows omitting it", () => {
    for (const value of [0, MASS_TONNES_INPUT_STEP / 10]) {
      const result = updateApplicationSchema.safeParse({
        applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        biocharAppliedTons: value,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ["biocharAppliedTons"],
              message: MASS_MIN_TONNES_MESSAGE,
            }),
          ]),
        );
      }
    }

    expect(
      updateApplicationSchema.safeParse({
        applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        cropType: "Maize",
      }).success,
    ).toBe(true);
  });

  it("rejects a create payload with only one GPS coordinate", () => {
    const result = createApplicationSchema.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: 1,
      gpsLatitude: -3.3349,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["gpsLongitude"],
            message: "Longitude is required when a latitude is entered.",
          }),
        ]),
      );
    }
  });

  it("allows clearing both GPS coordinates through the update action", () => {
    const result = updateApplicationSchema.safeParse({
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      gpsLatitude: null,
      gpsLongitude: null,
    });

    expect(result.success).toBe(true);
  });

  it("allows a partial coordinate payload before it is merged with saved state", () => {
    const result = updateApplicationSchema.safeParse({
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
        gpsLatitude: null,
        gpsLongitude: null,
      }).success,
    ).toBe(true);
  });

  it("strips submitted dry biochar so the server remains authoritative", () => {
    const createResult = createApplicationSchema.parse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: 100,
      biocharAppliedDryTons: 1,
      ...customerLocation,
    });
    const updateResult = updateApplicationSchema.parse({
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: 0.1,
      biocharAppliedDryTons: 0,
    });
    const formResult = applicationFormSchema.parse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: 100,
      biocharAppliedDryTons: 1,
      ...customerLocation,
    });

    expect(createResult).not.toHaveProperty("biocharAppliedDryTons");
    expect(updateResult).not.toHaveProperty("biocharAppliedDryTons");
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
      biocharAppliedTons: MASS_INPUT_MAX_KG,
    }).success).toBe(true);
    const result = applicationFormSchema.safeParse({
      ...base,
      biocharAppliedTons: MASS_INPUT_MAX_KG + 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["biocharAppliedTons"],
            message: MASS_MAX_KG_MESSAGE,
          }),
        ]),
      );
    }
  });

  it("retains tonne bounds for the create action payload", () => {
    const base = {
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      ...customerLocation,
    };

    expect(createApplicationSchema.safeParse({
      ...base,
      biocharAppliedTons: MASS_INPUT_MAX_TONNES,
    }).success).toBe(true);
    const result = createApplicationSchema.safeParse({
      ...base,
      biocharAppliedTons: MASS_INPUT_MAX_TONNES + 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["biocharAppliedTons"],
            message: MASS_MAX_TONNES_MESSAGE,
          }),
        ]),
      );
    }
  });
});
