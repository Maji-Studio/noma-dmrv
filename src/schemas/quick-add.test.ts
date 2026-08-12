import { describe, expect, it } from "vitest";
import { supplierQuickAddSchema } from "./suppliers";

const validSupplier = {
  name: "New Supplier",
  country: "Switzerland",
  gpsLatitude: "47.3769",
  gpsLongitude: "8.5417",
};

describe("supplierQuickAddSchema", () => {
  it("validates and coerces the minimal supplier payload", () => {
    expect(supplierQuickAddSchema.parse(validSupplier)).toEqual({
      name: "New Supplier",
      country: "Switzerland",
      gpsLatitude: 47.3769,
      gpsLongitude: 8.5417,
    });
  });

  it.each([
    ["name", "", "Supplier name is required"],
    ["country", "", "Country is required"],
    ["gpsLatitude", "", "Latitude is required"],
    ["gpsLongitude", "", "Longitude is required"],
  ] as const)("requires %s", (field, value, message) => {
    const result = supplierQuickAddSchema.safeParse({
      ...validSupplier,
      [field]: value,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: [field], message }),
        ]),
      );
    }
  });
});
