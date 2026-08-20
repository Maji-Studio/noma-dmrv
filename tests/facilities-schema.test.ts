import { describe, expect, it } from "vitest";
import {
  createFacilitySchema,
  facilityFormSchema,
  updateFacilitySchema,
} from "@/schemas/facilities";

const baseFacilityInput = {
  name: "Moshi Biochar Production Center",
  country: "Tanzania",
  durabilityOption: "200_year",
};

describe("facility schemas", () => {
  it("requires timezone when creating or editing a facility through the form", () => {
    const result = facilityFormSchema.safeParse(baseFacilityInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["timezone"],
            message: "Timezone is required",
          }),
        ]),
      );
    }
  });

  it("accepts a valid facility timezone", () => {
    const result = facilityFormSchema.safeParse({
      ...baseFacilityInput,
      timezone: "Africa/Nairobi",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a whitespace-only country and trims a padded one", () => {
    const whitespace = facilityFormSchema.safeParse({
      ...baseFacilityInput,
      timezone: "Africa/Nairobi",
      country: "   ",
    });

    expect(whitespace.success).toBe(false);
    if (!whitespace.success) {
      expect(whitespace.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["country"],
            message: "Country is required",
          }),
        ]),
      );
    }

    const padded = facilityFormSchema.safeParse({
      ...baseFacilityInput,
      timezone: "Africa/Nairobi",
      country: "  Tanzania  ",
    });

    expect(padded.success).toBe(true);
    if (padded.success) {
      expect(padded.data.country).toBe("Tanzania");
    }

    expect(
      updateFacilitySchema.safeParse({
        facilityId: "55555555-5555-4555-8555-555555555555",
        country: "   ",
      }).success,
    ).toBe(false);
  });

  it("rejects a facility create with only one GPS coordinate", () => {
    const result = createFacilitySchema.safeParse({
      ...baseFacilityInput,
      timezone: "Africa/Nairobi",
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
    const result = updateFacilitySchema.safeParse({
      facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      gpsLatitude: null,
      gpsLongitude: null,
    });

    expect(result.success).toBe(true);
  });

  it("rejects clearing only one GPS coordinate through the update action", () => {
    const result = updateFacilitySchema.safeParse({
      facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
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

  it("does not allow clearing timezone through the update action", () => {
    const result = updateFacilitySchema.safeParse({
      facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      timezone: null,
    });

    expect(result.success).toBe(false);
  });
});
