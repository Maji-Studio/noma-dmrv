import { describe, expect, it } from "vitest";
import { deriveBiocharProductProductionDate } from "./biochar-product-production-date";

const input = {
  placedAt: new Date("2026-10-21T22:30:00Z"),
  facilityTimezone: "Africa/Dar_es_Salaam",
  sourceRunDate: "2026-04-18",
};

describe("product production date", () => {
  it("dates a blend by its mixing day at the facility, across UTC midnight", () => {
    expect(deriveBiocharProductProductionDate({ ...input, composition: { ingredients: [{ massKg: 10 }] } }))
      .toBe("2026-10-22");
  });

  it("uses the previous local day west of UTC", () => {
    expect(deriveBiocharProductProductionDate({ ...input, placedAt: new Date("2026-10-22T00:30:00Z"),
      facilityTimezone: "America/New_York", composition: { ingredients: [{ massKg: 10 }] } }))
      .toBe("2026-10-21");
  });

  it.each([{}, { ingredients: [] }, { ingredients: [{ massKg: 0 }] }])(
    "keeps the source run day for a pure product with composition %j", composition => {
      expect(deriveBiocharProductProductionDate({ ...input, composition })).toBe(input.sourceRunDate);
    },
  );
});
