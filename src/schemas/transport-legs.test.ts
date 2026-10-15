import { describe, expect, it } from "vitest";
import { createTransportLegSchema, transportEntityTypes } from "./transport-legs";

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
