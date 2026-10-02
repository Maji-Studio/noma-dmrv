"use client";

/**
 * Read-only details panel for the order's delivery location (issue #196):
 * address, then the delivery route drawn like every transport leg. The route
 * opens its map in a dialog when both ends have coordinates.
 */

import { TransportRoutePreview } from "@/components/transport-legs";
import type { DistanceSourceValue } from "@/schemas/distance-source";

export interface CustomerLocationDetailsLocation {
  name: string | null;
  address: string | null;
  city: string | null;
  stateRegion: string | null;
  country: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  distanceFromFacilityKm: number | null;
  distanceSource: DistanceSourceValue | null;
}

export interface CustomerLocationDetailsFacility {
  name: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
}

interface CustomerLocationDetailsProps {
  location: CustomerLocationDetailsLocation;
  /** The order's facility — distance/map origin. Undefined while loading. */
  facility: CustomerLocationDetailsFacility | undefined;
}

export function CustomerLocationDetails({
  location,
  facility,
}: CustomerLocationDetailsProps) {
  const localityLine = [location.city, location.stateRegion, location.country]
    .filter(Boolean)
    .join(", ");

  return (
    // Unboxed like every other block in the form (layout contract).
    <div className="space-y-12" data-testid="order-location-details">
      <div className="space-y-2">
        {/* The location select above already names the location. */}
        <span className="body-small font-medium text-[var(--color-text-primary)]">
          Delivery location
        </span>
        {/* The site description is optional: when there is none, the
            locality line below already says where the location is, so an
            empty "Not recorded" pair would only add noise (Kenji, 2026-09-30). */}
        {location.address && (
          <p className="body-small text-[var(--color-text-primary)]">
            {location.address}
          </p>
        )}
        {localityLine && (
          <p className="body-caption text-[var(--color-text-secondary)]">
            {localityLine}
          </p>
        )}
      </div>

      {/* The route this order's deliveries will drive, drawn like every saved leg. */}
      <div data-testid="order-location-distance">
        <TransportRoutePreview
          entityType="biochar"
          title="Delivery route"
          originName={facility?.name}
          destinationName={location.name}
          originPoint={{ lat: facility?.gpsLatitude, lng: facility?.gpsLongitude }}
          destinationPoint={{ lat: location.gpsLatitude, lng: location.gpsLongitude }}
          distanceKm={location.distanceFromFacilityKm}
          distanceSource={location.distanceSource}
          loadMassKg={null}
          plannedRoute
          emptyMessage="Distance from facility not recorded."
        />
      </div>
    </div>
  );
}
