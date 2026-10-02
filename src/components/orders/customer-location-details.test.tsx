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
  it("names the delivery location by its address, not by repeating its name in the header", () => {
    const html = renderToStaticMarkup(<CustomerLocationDetails location={location} facility={facility} />);
    const header = html.slice(0, html.indexOf("Plot 12, Kilolo road"));

    expect(header).toContain("Delivery location");
    expect(header).not.toContain("North field");
  });

  it("draws the delivery route from the facility at the stored one-way distance", () => {
    const rendered = renderToStaticMarkup(<CustomerLocationDetails location={location} facility={facility} />)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ");

    expect(rendered).toContain("Moshi plant");
    expect(rendered).toContain("North field");
    expect(rendered).toContain("Road · 25 km one way");
    expect(rendered).toContain("50 km round trip");
    expect(rendered).toContain("Route calculation");
  });

  it("carries no load and no CERT chip before any goods move", () => {
    const html = renderToStaticMarkup(<CustomerLocationDetails location={location} facility={facility} />);

    expect(html).not.toContain(" load");
    expect(html).not.toContain("data-cert-field=");
  });

  it("says when no distance from the facility is recorded", () => {
    const html = renderToStaticMarkup(
      <CustomerLocationDetails location={{ ...location, distanceFromFacilityKm: null }} facility={facility} />,
    );
    expect(html).toContain("Distance from facility not recorded.");
    expect(html).not.toContain("Route calculation");
  });
});
