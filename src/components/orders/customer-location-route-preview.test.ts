import { describe, expect, it } from "vitest";
import type { RouteGeometry } from "@/lib/geo/types";
import { resolveCustomerLocationRoutePreview } from "./customer-location-route-preview";

const FACILITY = { lat: 47.3769, lng: 8.5417 };
const DESTINATION = { lat: 46.948, lng: 7.4474 };
const ENDPOINT_COORDINATES: [number, number][] = [
  [FACILITY.lng, FACILITY.lat],
  [DESTINATION.lng, DESTINATION.lat],
];

describe("resolveCustomerLocationRoutePreview", () => {
  it("uses the straight fallback while route geometry is loading", () => {
    expect(
      resolveCustomerLocationRoutePreview(FACILITY, DESTINATION, undefined)
    ).toEqual({
      coordinates: ENDPOINT_COORDINATES,
      boundsCoordinates: ENDPOINT_COORDINATES,
      routed: false,
      state: "loading",
    });
  });

  it.each([
    ["missing", null],
    [
      "too short",
      { coordinates: [[8.2, 47.1]], distanceKm: 10 } satisfies RouteGeometry,
    ],
  ])("uses the straight fallback when geometry is %s", (_label, geometry) => {
    const preview = resolveCustomerLocationRoutePreview(
      FACILITY,
      DESTINATION,
      geometry
    );

    expect(preview.coordinates).toEqual(ENDPOINT_COORDINATES);
    expect(preview.routed).toBe(false);
    expect(preview.state).toBe("fallback");
  });

  it("uses road coordinates and includes the full route in the bounds", () => {
    const routeCoordinates: [number, number][] = [
      [8.5, 47.3],
      [9.1, 47.8],
      [7.5, 47],
    ];

    const preview = resolveCustomerLocationRoutePreview(
      FACILITY,
      DESTINATION,
      { coordinates: routeCoordinates, distanceKm: 132 }
    );

    expect(preview).toEqual({
      coordinates: routeCoordinates,
      boundsCoordinates: [
        ENDPOINT_COORDINATES[0],
        ...routeCoordinates,
        ENDPOINT_COORDINATES[1],
      ],
      routed: true,
      state: "road",
    });
  });
});
