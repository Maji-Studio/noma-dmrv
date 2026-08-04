import { describe, expect, it } from "vitest";
import {
  applicationFormSchema,
  createApplicationSchema,
  updateApplicationSchema,
} from "@/schemas/applications";
import {
  MASS_INPUT_MAX_KG,
  MASS_INPUT_MAX_TONNES,
  MASS_MAX_KG_MESSAGE,
  MASS_MAX_TONNES_MESSAGE,
} from "@/schemas/helpers";

describe("application schemas", () => {
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

  it("rejects clearing only one GPS coordinate through the update action", () => {
    const result = updateApplicationSchema.safeParse({
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      gpsLatitude: null,
      gpsLongitude: 37.3404,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["gpsLatitude"],
            message: "Latitude is required when a longitude is entered.",
          }),
        ]),
      );
    }
  });

  it("strips submitted dry biochar so the server remains authoritative", () => {
    const createResult = createApplicationSchema.parse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: 100,
      biocharAppliedDryTons: 1,
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
    });

    expect(createResult).not.toHaveProperty("biocharAppliedDryTons");
    expect(updateResult).not.toHaveProperty("biocharAppliedDryTons");
    expect(formResult).not.toHaveProperty("biocharAppliedDryTons");
  });

  it("uses kilogram bounds and copy for client form mass fields", () => {
    const base = {
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
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
