import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/hooks/use-geo", () => ({ useRouteGeometries: () => ({ isPending: false, data: undefined }) }));

import { CustomerLocationDetails, type CustomerLocationDetailsLocation } from "./customer-location-details";

const location: CustomerLocationDetailsLocation = {
  name: "North field",
  address: "Plot 12, Kilolo road",
  city: "Iringa",
  stateRegion: null,
  country: "Tanzania",
  gpsLatitude: null,
  gpsLongitude: null,
  distanceFromFacilityKm: 25,
  distanceSource: "map_estimate",
};
const facility = { name: "Moshi plant", gpsLatitude: null, gpsLongitude: null };

describe("CustomerLocationDetails", () => {
  it("does not repeat the selected location name in its header", () => {
    const html = renderToStaticMarkup(<CustomerLocationDetails location={location} facility={facility} />);
    expect(html).toContain("Delivery location");
    expect(html).not.toContain("North field");
  });

  it("names the distance source in sentence case, in parentheses", () => {
    const html = renderToStaticMarkup(<CustomerLocationDetails location={location} facility={facility} />);
    expect(html).toContain("25 km from Moshi plant (route calculation)");
    expect(html).not.toContain(" · ");
    expect(html).not.toContain("uppercase");
  });

  it("drops the source when no distance is recorded", () => {
    const html = renderToStaticMarkup(
      <CustomerLocationDetails location={{ ...location, distanceFromFacilityKm: null }} facility={facility} />,
    );
    expect(html).toContain("Distance from facility not recorded");
    expect(html).not.toContain("(route calculation)");
  });
});
