/** Customer side-sheet view mode: the sections config for EntitySideSheet. */
import { partyLocationsSection, type PartyLocationsQueryState } from "@/components/party-locations-read-state";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { CustomerWithRelations } from "@/data-access/customers";

export function customerSheetSections(customer: CustomerWithRelations, locationsQuery: PartyLocationsQueryState): DetailPanelSection[] {
  return [
    {
      title: "Customer",
      fields: [
        { label: "Customer name", value: customer.name },
        { label: "Contact email", value: customer.contactEmail },
        { label: "Contact phone", value: customer.contactPhone },
        { label: "Crop type", value: customer.cropType },
        { label: "Address", value: customer.address },
      ],
    },
    partyLocationsSection("Customer", customer.id, locationsQuery, {
      distanceLabel: "Distance from facility (one way)",
      defaultLabel: "Default destination",
      positionLabel: "Application site position",
      descriptionLabel: "Site description",
      includeSoilTemperature: true,
    }),
  ];
}
