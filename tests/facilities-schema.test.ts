import { describe, expect, it } from "vitest";
import {
  facilityFormSchema,
  updateFacilitySchema,
} from "@/schemas/facilities";

const baseFacilityInput = {
  name: "Moshi Biochar Production Center",
  country: "Tanzania",
  defaultDurabilityOption: "200_year",
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

  it("does not allow clearing timezone through the update action", () => {
    const result = updateFacilitySchema.safeParse({
      facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      timezone: null,
    });

    expect(result.success).toBe(false);
  });
});
