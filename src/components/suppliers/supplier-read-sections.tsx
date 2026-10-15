/** Supplier side-sheet view mode: the sections config for EntitySideSheet. */
import { buildSupplierDefaultLocationDistanceField } from "./supplier-detail-fields";
import { partyLocationsSection, type PartyLocationsQueryState } from "@/components/party-locations-read-state";
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
    partyLocationsSection("Supplier", supplier.id, locationsQuery, {
      distanceLabel: "Distance to facility (one way)",
      defaultLabel: "Default source location",
      positionLabel: "Source location position",
    }),
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
