import { describe, expect, it } from "vitest";
import { supplierFormSchema, supplierLocationFormSchema } from "@/schemas/suppliers";

function fieldErrors(result: { success: false; error: { issues: { path: PropertyKey[] }[] } }) {
  return result.error.issues.map((i) => i.path.join("."));
}

// Supplier-level GPS is now optional region metadata held as number | null
// (set from the map picker, defaulting to null). Precise, required coordinates
// moved per-location into supplierLocationFormSchema (mirrors customers).
describe("supplierFormSchema GPS validation (optional, supplier-level)", () => {
  const validSupplierInput = {
    name: "Acme Biomass",
    gpsLatitude: -1.2921,
    gpsLongitude: 36.8219,
  };

  it("accepts numeric coordinates", () => {
    const result = supplierFormSchema.safeParse(validSupplierInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gpsLatitude).toBe(-1.2921);
      expect(result.data.gpsLongitude).toBe(36.8219);
    }
  });

  it("accepts omitted GPS (supplier-level coordinates are optional)", () => {
    const result = supplierFormSchema.safeParse({ name: "No-GPS Supplier" });
    expect(result.success).toBe(true);
  });

  it("accepts null GPS", () => {
    const result = supplierFormSchema.safeParse({
      name: "Null-GPS Supplier",
      gpsLatitude: null,
      gpsLongitude: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects latitude outside -90..90", () => {
    const result = supplierFormSchema.safeParse({ ...validSupplierInput, gpsLatitude: 91 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result)).toContain("gpsLatitude");
    }
  });

  it("rejects longitude outside -180..180", () => {
    const result = supplierFormSchema.safeParse({ ...validSupplierInput, gpsLongitude: -181 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result)).toContain("gpsLongitude");
    }
  });
});

// Per-location GPS is required and coerced from form string inputs — the
// precise-coordinate validation the supplier form schema used to carry.
describe("supplierLocationFormSchema GPS validation (required, per-location)", () => {
  const validLocationInput = {
    country: "Kenya",
    gpsLatitude: "-1.2921",
    gpsLongitude: "36.8219",
  };

  it("accepts and coerces valid string coordinates to numbers", () => {
    const result = supplierLocationFormSchema.safeParse(validLocationInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gpsLatitude).toBe(-1.2921);
      expect(result.data.gpsLongitude).toBe(36.8219);
      expect(typeof result.data.gpsLatitude).toBe("number");
      expect(typeof result.data.gpsLongitude).toBe("number");
    }
  });

  it("accepts exact boundary values", () => {
    const cases = [
      { gpsLatitude: "90", gpsLongitude: "180" },
      { gpsLatitude: "-90", gpsLongitude: "-180" },
    ];
    for (const coords of cases) {
      const result = supplierLocationFormSchema.safeParse({ ...validLocationInput, ...coords });
      expect(result.success).toBe(true);
    }
  });

  it("rejects latitude outside -90..90", () => {
    const result = supplierLocationFormSchema.safeParse({
      ...validLocationInput,
      gpsLatitude: "91",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result)).toContain("gpsLatitude");
    }
  });

  it("rejects longitude outside -180..180", () => {
    const result = supplierLocationFormSchema.safeParse({
      ...validLocationInput,
      gpsLongitude: "-181",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result)).toContain("gpsLongitude");
    }
  });

  it("requires GPS latitude (empty string fails)", () => {
    const result = supplierLocationFormSchema.safeParse({ ...validLocationInput, gpsLatitude: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result)).toContain("gpsLatitude");
    }
  });

  it("requires GPS longitude (empty string fails)", () => {
    const result = supplierLocationFormSchema.safeParse({ ...validLocationInput, gpsLongitude: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result)).toContain("gpsLongitude");
    }
  });

  it("requires GPS latitude (undefined fails)", () => {
    const result = supplierLocationFormSchema.safeParse({
      ...validLocationInput,
      gpsLatitude: undefined,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result)).toContain("gpsLatitude");
    }
  });

  it("requires GPS longitude (undefined fails)", () => {
    const result = supplierLocationFormSchema.safeParse({
      ...validLocationInput,
      gpsLongitude: undefined,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result)).toContain("gpsLongitude");
    }
  });
});
