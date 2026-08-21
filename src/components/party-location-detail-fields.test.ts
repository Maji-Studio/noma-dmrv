import { describe, expect, it } from "vitest";
import { isMissingValueCopy } from "@/lib/copy-utils";
import { buildPartyLocationDetailFields } from "./party-location-detail-fields";

/** Mirrors the customer-list call site verbatim (customer-list.tsx). */
const options = {
  distanceLabel: "One-way distance from facility (per leg, km)",
  defaultLabel: "Default destination",
  positionLabel: "Application site position",
  descriptionLabel: "Site description",
  includeSoilTemperature: true,
};

describe("buildPartyLocationDetailFields", () => {
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
      "One-way distance from facility (per leg, km)",
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
      distanceFromFacilityKm: 12,
      defaultSoilTemperatureC: 24,
      isDefault: true,
    };
    const fields = buildPartyLocationDetailFields([location, location], options);

    expect(fields[0].label).toBe("Location 1 · Location name");
    expect(fields[10].label).toBe("Location 2 · Location name");
    expect(fields[8].value).toBe("12 km");
  });
});
