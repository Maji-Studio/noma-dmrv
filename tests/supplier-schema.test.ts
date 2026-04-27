import { describe, expect, it } from "vitest";
import { supplierFormSchema } from "@/schemas/suppliers";

const validSupplierInput = {
  name: "Acme Biomass",
  gpsLatitude: "-1.2921",
  gpsLongitude: "36.8219",
};

describe("supplierFormSchema GPS validation", () => {
  it("accepts valid GPS coordinates", () => {
    const result = supplierFormSchema.safeParse(validSupplierInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gpsLatitude).toBe(-1.2921);
      expect(result.data.gpsLongitude).toBe(36.8219);
    }
  });

  it("rejects latitude outside -90..90", () => {
    const result = supplierFormSchema.safeParse({
      ...validSupplierInput,
      gpsLatitude: "91",
    });
    expect(result.success).toBe(false);
  });

  it("rejects longitude outside -180..180", () => {
    const result = supplierFormSchema.safeParse({
      ...validSupplierInput,
      gpsLongitude: "-181",
    });
    expect(result.success).toBe(false);
  });

  it("requires GPS latitude (empty string fails)", () => {
    const result = supplierFormSchema.safeParse({
      ...validSupplierInput,
      gpsLatitude: "",
    });
    expect(result.success).toBe(false);
  });

  it("requires GPS longitude (empty string fails)", () => {
    const result = supplierFormSchema.safeParse({
      ...validSupplierInput,
      gpsLongitude: "",
    });
    expect(result.success).toBe(false);
  });

  it("coerces string coordinates to numbers", () => {
    const result = supplierFormSchema.safeParse({
      name: "Test Supplier",
      gpsLatitude: "45.5",
      gpsLongitude: "-122.6",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.gpsLatitude).toBe("number");
      expect(typeof result.data.gpsLongitude).toBe("number");
    }
  });
});
