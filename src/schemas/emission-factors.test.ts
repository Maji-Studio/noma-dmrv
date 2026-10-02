import { describe, expect, it } from "vitest";
import { saveFacilityEmissionFactorsSchema } from "./emission-factors";

const BASE = {
  facilityId: "0987ce3e-7d5f-44dd-9ab9-089d5b1c7572",
  dieselKgCo2ePerLitre: "2.68",
  gridKgCo2ePerKwh: "0.45",
  roadFreightKgCo2ePerTonneKm: "0.107",
  sourceNote: "",
};

describe("saveFacilityEmissionFactorsSchema", () => {
  it("keeps a null expected version as null, not the epoch", () => {
    expect(saveFacilityEmissionFactorsSchema.parse({ ...BASE, expectedUpdatedAt: null }).expectedUpdatedAt).toBeNull();
  });

  it("coerces a loaded version and leaves an omitted one undefined", () => {
    const loaded = "2026-10-01T10:00:00.123Z";
    expect(saveFacilityEmissionFactorsSchema.parse({ ...BASE, expectedUpdatedAt: loaded }).expectedUpdatedAt).toEqual(new Date(loaded));
    expect(saveFacilityEmissionFactorsSchema.parse(BASE).expectedUpdatedAt).toBeUndefined();
  });

  it("requires every factor and stores a blank source as null", () => {
    const parsed = saveFacilityEmissionFactorsSchema.safeParse({ ...BASE, gridKgCo2ePerKwh: "" });
    expect(parsed.success).toBe(false);
    expect(saveFacilityEmissionFactorsSchema.parse(BASE)).toMatchObject({ gridKgCo2ePerKwh: 0.45, sourceNote: null });
  });
});
