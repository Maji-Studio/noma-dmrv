import { describe, expect, it } from "vitest";
import { createTransportLegSchema, transportEntityTypes, transportLegFormSchema, updateTransportLegSchema } from "./transport-legs";

const input = {
  entityId: "00000000-0000-4000-8000-000000000001",
  distanceKm: 10,
  loadMassKg: 100,
};

describe("manual transport creation", () => {
  it("rejects biochar writes while retaining biochar in the read enum", () => {
    const result = createTransportLegSchema.safeParse({ ...input, entityType: "biochar" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["entityType"]);
    expect(transportEntityTypes).toContain("biochar");
  });

  it.each(["feedstock", "sample"])("accepts %s legs", (entityType) => {
    expect(createTransportLegSchema.safeParse({ ...input, entityType }).success).toBe(true);
  });
});

describe("model year", () => {
  const nextYear = new Date().getFullYear() + 1;
  const schemas = [transportLegFormSchema, createTransportLegSchema, updateTransportLegSchema];
  const leg = { ...input, entityType: "feedstock", id: input.entityId, expectedVersion: 1 };

  it.each([1899, 2020.5, 99999999999, nextYear + 1])("rejects %s at every boundary", (modelYear) => {
    for (const schema of schemas) {
      expect(schema.safeParse({ ...leg, modelYear }).success).toBe(false);
      expect(schema.safeParse({ ...leg, modelYear: String(modelYear) }).success).toBe(false);
    }
  });

  it.each([1900, nextYear, null, undefined, "", "2020"])("accepts optional valid year %s", (modelYear) => {
    for (const schema of schemas) expect(schema.safeParse({ ...leg, modelYear }).success).toBe(true);
  });
});
