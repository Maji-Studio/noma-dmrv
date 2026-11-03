import { describe, expect, it } from "vitest";
import type { FacilityWithRelations } from "@/data-access/facilities";
import { facilitySheetSections } from "./facility-read-sections";

const facility = (overrides: Partial<FacilityWithRelations>) => ({
  id: "f1", name: "TZ001", country: "Tanzania", timezone: "UTC", location: null, address: null,
  gpsLatitude: -6.163, gpsLongitude: 35.7516, durabilityOption: "200_year",
  reactorCount: 0, storageSummary: { feedstockBinCount: 0, biocharBinCount: 0, productBinCount: 0 },
  inventorySummary: { feedstockWetKg: 0 }, ...overrides,
}) as unknown as FacilityWithRelations;

const labels = (f: FacilityWithRelations) => facilitySheetSections(f)[0].fields.map((field) => field.label);

describe("facility sheet location", () => {
  it("leaves the Location row out when only coordinates exist, as the position fields list them", () => {
    expect(labels(facility({}))).not.toContain("Location");
    expect(labels(facility({}))).toContain("Facility position latitude");
  });

  it("shows the place text when there is one, and says not recorded when nothing is known", () => {
    expect(labels(facility({ location: "Dodoma" }))).toContain("Location");
    expect(labels(facility({ gpsLatitude: undefined, gpsLongitude: undefined }))).toContain("Location");
  });
});
