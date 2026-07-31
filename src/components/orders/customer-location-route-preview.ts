import type { RouteGeometry } from "@/lib/geo/types";

export interface CustomerLocationMapPoint {
  lat: number;
  lng: number;
}

export type CustomerLocationRoutePreviewState =
  | "loading"
  | "road"
  | "fallback";

interface CustomerLocationRoutePreview {
  coordinates: [number, number][];
  boundsCoordinates: [number, number][];
  routed: boolean;
  state: CustomerLocationRoutePreviewState;
}

/**
 * Select the honest line and fit coordinates for the delivery-location map.
 * Undefined means routing is unresolved; null means routing resolved without
 * geometry. Both draw the endpoint connector, but remain distinct for copy.
 */
export function resolveCustomerLocationRoutePreview(
  facility: CustomerLocationMapPoint,
  destination: CustomerLocationMapPoint,
  routeGeometry: RouteGeometry | null | undefined
): CustomerLocationRoutePreview {
  const endpointCoordinates: [number, number][] = [
    [facility.lng, facility.lat],
    [destination.lng, destination.lat],
  ];
  const hasRoadGeometry =
    routeGeometry != null && routeGeometry.coordinates.length >= 2;

  if (!hasRoadGeometry) {
    return {
      coordinates: endpointCoordinates,
      boundsCoordinates: endpointCoordinates,
      routed: false,
      state: routeGeometry === undefined ? "loading" : "fallback",
    };
  }

  return {
    coordinates: routeGeometry.coordinates,
    boundsCoordinates: [
      endpointCoordinates[0],
      ...routeGeometry.coordinates,
      endpointCoordinates[1],
    ],
    routed: true,
    state: "road",
  };
}
