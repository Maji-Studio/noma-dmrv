import { describe, expect, it } from "vitest";
import { isMissingValueCopy } from "@/lib/copy-utils";
import { buildPartyLocationDetailFields } from "./party-location-detail-fields";

/** Mirrors the customer read-sheet call site verbatim (customer-read-sections.tsx). */
const options = {
  distanceLabel: "Distance from facility (one way)",
  defaultLabel: "Default destination",
  positionLabel: "Application site position",
  descriptionLabel: "Site description",
  includeSoilTemperature: true,
};

describe("buildPartyLocationDetailFields", () => {
  it("marks every location field pending, including soil temperature and defaults", () => {
    const fields = buildPartyLocationDetailFields([], { ...options, pending: true });

    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every(field => field.pending)).toBe(true);
  });

  it("keeps the customer-location form field order and empty values", () => {
    const fields = buildPartyLocationDetailFields([], options);

    expect(fields.map((field) => field.label)).toEqual([
      "Location name",
      "Country",
      "State / region",
      "City",
      "Site description",
      "Application site position latitude",
      "Application site position longitude",
      "Default soil temperature (°C)",
      "Distance from facility (one way)",
      "Default destination",
    ]);
    expect(
      fields.every(
        (field) => field.value == null || isMissingValueCopy(field.value),
      ),
    ).toBe(true);
  });

  it("keeps the supplier wording when no description label is passed", () => {
    const fields = buildPartyLocationDetailFields([], {
      distanceLabel: options.distanceLabel,
      defaultLabel: options.defaultLabel,
      positionLabel: options.positionLabel,
      includeSoilTemperature: options.includeSoilTemperature,
    });

    expect(fields[4].label).toBe("Address / description");
  });

  it("prefixes repeated locations while preserving each location's field order", () => {
    const location = {
      name: "North field",
      country: "Tanzania",
      stateRegion: null,
      city: null,
      address: null,
      gpsLatitude: -3.3,
      gpsLongitude: 37.3,
      facilityDistances: [{ facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", facilityName: "Test facility", distanceKm: 12, distanceSource: "manual" as const }],
      defaultSoilTemperatureC: 24,
      isDefault: true,
    };
    const fields = buildPartyLocationDetailFields([location, location], options);

    expect(fields[0].label).toBe("Location 1 · Location name");
    expect(fields[10].label).toBe("Location 2 · Location name");
    expect(fields[8].value).toBe("Test facility: 12 km (Manual entry)");
  });

  it("lists archived customer locations after the active ones and marks them", () => {
    const base = {
      country: "Tanzania", stateRegion: null, city: null, address: null, gpsLatitude: -3.3, gpsLongitude: 37.3,
      facilityDistances: [], defaultSoilTemperatureC: null, isDefault: false,
    };
    const fields = buildPartyLocationDetailFields([
      { ...base, name: "Old field", archivedAt: new Date("2026-02-01") },
      { ...base, name: "North field", isDefault: true, archivedAt: null },
    ], options);

    expect(fields[0]).toMatchObject({ label: "Location 1 · Location name", value: "North field" });
    expect(fields[10]).toMatchObject({ label: "Location 2 (archived) · Location name", value: "Old field" });
  });
});
