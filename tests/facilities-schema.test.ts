import { describe, expect, it } from "vitest";
import {
  addressSchema,
  createFacilitySchema,
  facilityFormSchema,
  quickAddFacilitySchema,
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

  const countryEntryPaths = [
    {
      name: "addressSchema",
      schema: addressSchema,
      withCountry: (country: string) => ({ country }),
    },
    {
      name: "facilityFormSchema",
      schema: facilityFormSchema,
      withCountry: (country: string) => ({
        ...baseFacilityInput,
        timezone: "Africa/Nairobi",
        country,
      }),
    },
    {
      name: "updateFacilitySchema",
      schema: updateFacilitySchema,
      withCountry: (country: string) => ({
        facilityId: "55555555-5555-4555-8555-555555555555",
        country,
      }),
    },
    {
      name: "quickAddFacilitySchema",
      schema: quickAddFacilitySchema,
      withCountry: (country: string) => ({
        name: "Moshi Biochar Production Center",
        country,
      }),
    },
  ] as const;

  it.each(countryEntryPaths)(
    "rejects a whitespace-only country and trims a padded one in $name",
    ({ schema, withCountry }) => {
      const whitespace = schema.safeParse(withCountry("   "));

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

      const padded = schema.safeParse(withCountry("  Tanzania  "));

      expect(padded.success).toBe(true);
      if (padded.success) {
        expect(padded.data.country).toBe("Tanzania");
      }
    },
  );

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
