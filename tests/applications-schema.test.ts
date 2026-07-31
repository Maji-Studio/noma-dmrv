import { describe, expect, it } from "vitest";
import {
  createApplicationSchema,
  updateApplicationSchema,
} from "@/schemas/applications";

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

  it("rejects create input whose manually entered dry mass exceeds wet mass", () => {
    const result = createApplicationSchema.safeParse({
      applicationDate: new Date("2026-06-13"),
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: 100,
      biocharAppliedDryTons: 101,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["biocharAppliedDryTons"],
            message: "Dry mass cannot exceed wet mass. Reduce the dry mass.",
          }),
        ]),
      );
    }
  });

  it("rejects update input whose manually entered dry mass exceeds wet mass", () => {
    const result = updateApplicationSchema.safeParse({
      applicationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      biocharAppliedTons: 0.1,
      biocharAppliedDryTons: 0.101,
    });

    expect(result.success).toBe(false);
  });
});
