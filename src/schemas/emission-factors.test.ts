import { describe, expect, it } from "vitest";
import { saveFacilityEmissionFactorsSchema } from "./emission-factors";

const BASE = {
  expectedVersion: null,
  facilityId: "0987ce3e-7d5f-44dd-9ab9-089d5b1c7572",
  dieselKgCo2ePerLitre: "2.68",
  gridKgCo2ePerKwh: "0.45",
  roadFreightKgCo2ePerTonneKm: "0.107",
  sourceNote: "",
};

describe("saveFacilityEmissionFactorsSchema", () => {
  it("keeps a null expected version as null, not the epoch", () => {
    expect(saveFacilityEmissionFactorsSchema.parse({ ...BASE, expectedVersion: null }).expectedVersion).toBeNull();
  });

  it("requires a positive integer or an explicit null", () => {
    expect(saveFacilityEmissionFactorsSchema.parse({ ...BASE, expectedVersion: 3 }).expectedVersion).toBe(3);
    for (const expectedVersion of [undefined, 0, -1, 1.5, "3"]) {
      expect(saveFacilityEmissionFactorsSchema.safeParse({ ...BASE, expectedVersion }).success).toBe(false);
    }
  });

  it("requires every factor and stores a blank source as null", () => {
    const parsed = saveFacilityEmissionFactorsSchema.safeParse({ ...BASE, gridKgCo2ePerKwh: "" });
    expect(parsed.success).toBe(false);
    expect(saveFacilityEmissionFactorsSchema.parse(BASE)).toMatchObject({ gridKgCo2ePerKwh: 0.45, sourceNote: null });
  });
});
