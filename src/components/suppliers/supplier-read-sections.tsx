/** Supplier side-sheet view mode: the sections config for EntitySideSheet. */
import { buildPartyLocationDetailFields } from "@/components/party-location-detail-fields";
import { buildSupplierFallbackDistanceField } from "./supplier-detail-fields";
import { SupplierLocationsReadState } from "./supplier-locations-read-state";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { UseQueryResult } from "@tanstack/react-query";
import type { SupplierWithRelations } from "@/data-access/suppliers";
import type { SupplierLocation } from "@/db/schema";

/** The supplier's locations query, as the sheet reads it. */
export type SupplierLocationsQueryState = Pick<UseQueryResult<SupplierLocation[]>, "data" | "isPending" | "isError" | "isFetching" | "refetch">;

export function supplierSheetSections(supplier: SupplierWithRelations, locationsQuery: SupplierLocationsQueryState): DetailPanelSection[] {
  const locations = locationsQuery.data ?? [];
  return [
    {
      title: "Supplier",
      fields: [
        { label: "Supplier name", value: supplier.name },
      ],
    },
    {
      title: "Locations",
      fields:
        locationsQuery.data === undefined
          ? []
          : buildPartyLocationDetailFields(locations, {
              distanceLabel:
                "Distance to facility (one way)",
              defaultLabel: "Default source location",
              positionLabel: "Source location position",
            }),
      content: (
        <SupplierLocationsReadState
          isPending={locationsQuery.isPending}
          isError={locationsQuery.isError}
          isRetrying={locationsQuery.isFetching}
          onRetry={() => void locationsQuery.refetch()}
        />
      ),
    },
    {
      title: "Contact information",
      fields: [
        { label: "Contact name", value: supplier.contactName },
        { label: "Contact phone", value: supplier.contactPhone },
        { label: "Contact email", value: supplier.contactEmail },
      ],
    },
    {
      title: "Sourcing information",
      fields: [
        { label: "Location", value: supplier.location },
        { label: "Source region", value: supplier.sourceRegion },
        { label: "Address", value: supplier.address },
        buildSupplierFallbackDistanceField({
          defaultLocationDistanceKm:
            locations.find((location) => location.isDefault)
              ?.distanceFromFacilityKm ?? null,
          legacySupplierDistanceKm:
            supplier.distanceToFacilityKm,
          locationsLoaded:
            locationsQuery.data !== undefined,
        }),
      ],
    },
  ];
}
