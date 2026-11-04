import { describe, expect, it } from "vitest";
import { formatFacilityLocation, joinLocationParts } from "./location-display";
import { formatSupplierLocationDisplay } from "./supplier-location-display";

describe("joinLocationParts", () => {
  it("reads a town that is also its region once", () => {
    expect(joinLocationParts(["Ihemi", "Ihemi", "Tanzania"])).toBe("Ihemi, Tanzania");
    expect(joinLocationParts(["Ihemi", " ihemi ", "Tanzania"])).toBe("Ihemi, Tanzania");
  });

  it("keeps distinct parts in order and skips blanks", () => {
    expect(joinLocationParts([null, "Mbeya", "", "Songwe", undefined, "Tanzania"])).toBe("Mbeya, Songwe, Tanzania");
    expect(joinLocationParts([null, " ", undefined])).toBeNull();
  });

  it("dedupes a supplier source location label", () => {
    expect(formatSupplierLocationDisplay({ city: "Ihemi", stateRegion: "Ihemi", country: "Tanzania" })).toBe("Ihemi, Tanzania");
  });
});

describe("formatFacilityLocation", () => {
  it("prefers the place text", () => {
    expect(formatFacilityLocation({ location: "Dodoma", gpsLatitude: -6.163, gpsLongitude: 35.7516 })).toBe("Dodoma");
  });

  it("falls back to the coordinates when no place text is recorded", () => {
    expect(formatFacilityLocation({ location: null, gpsLatitude: -6.163, gpsLongitude: 35.7516 })).toBe("-6.163, 35.7516");
    expect(formatFacilityLocation({ location: " ", gpsLatitude: 0, gpsLongitude: 0 })).toBe("0, 0");
  });

  it("is empty when nothing is recorded", () => {
    expect(formatFacilityLocation({ location: null, gpsLatitude: null, gpsLongitude: 35.7 })).toBeNull();
  });
});
