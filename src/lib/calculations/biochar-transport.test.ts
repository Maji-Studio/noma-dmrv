import { describe, expect, it } from "vitest";
import { calculateBiocharTransport } from "./biochar-transport";

describe("Removal biochar transport", () => {
  it("counts 25 kg applied from a 50 kg delivery at 10 km as 0.5 tonne-km, regardless of the 100 kg produced", () => {
    expect(calculateBiocharTransport([{ loadMassKg: 25, distanceKm: 10 }])).toEqual({
      massDistanceTonneKm: 0.5,
      loadMassKg: 25,
    });
  });
  it("sums two delivery slices at their own distances using wet mass", () => {
    expect(calculateBiocharTransport([{ loadMassKg: 25, distanceKm: 10 }, { loadMassKg: 40, distanceKm: 30 }])).toEqual({ loadMassKg: 65, massDistanceTonneKm: 2.9 });
  });
  it.each([0, -1, NaN, Infinity])("refuses unusable delivery distance %s", distanceKm => {
    expect(() => calculateBiocharTransport([{ loadMassKg: 25, distanceKm }])).toThrow(/distance/);
  });
});
