/** Supplier side-sheet view mode: the sections config for EntitySideSheet. */
import { buildPartyLocationDetailFields } from "@/components/party-location-detail-fields";
import { buildSupplierDefaultLocationDistanceField } from "./supplier-detail-fields";
import { PartyLocationsReadState, type PartyLocationsQueryState } from "@/components/party-locations-read-state";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { SupplierWithRelations } from "@/data-access/suppliers";

export function supplierSheetSections(supplier: SupplierWithRelations, locationsQuery: PartyLocationsQueryState): DetailPanelSection[] {
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
        locationsQuery.isError && locationsQuery.data === undefined
          ? []
          : buildPartyLocationDetailFields(locations, {
              distanceLabel:
                "Distance to facility (one way)",
              defaultLabel: "Default source location",
              positionLabel: "Source location position",
              pending: locationsQuery.isPending,
            }),
      content: (
        <PartyLocationsReadState
          partyLabel="Supplier"
          isPending={locationsQuery.isPending}
          isError={locationsQuery.isError}
          isRetrying={locationsQuery.isFetching}
          hasCachedData={locationsQuery.data !== undefined}
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
        buildSupplierDefaultLocationDistanceField({
          defaultLocationDistanceKm:
            locations.find((location) => location.isDefault)
              ?.distanceFromFacilityKm ?? null,
          locationsLoaded:
            locationsQuery.data !== undefined,
          locationsError: locationsQuery.isError,
        }),
      ],
    },
  ];
}
