/** Customer side-sheet view mode: the sections config for EntitySideSheet. */
import { buildPartyLocationDetailFields } from "@/components/party-location-detail-fields";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { CustomerWithRelations } from "@/data-access/customers";
import type { PartyLocationDetail } from "@/components/party-location-detail-fields";

export function customerSheetSections(customer: CustomerWithRelations, locations: PartyLocationDetail[]): DetailPanelSection[] {
  return [
    {
      title: "Required information",
      fields: [
        { label: "Customer name", value: customer.name },
      ],
    },
    {
      title: "Locations",
      fields: buildPartyLocationDetailFields(locations, {
        distanceLabel: "One-way distance from facility (per leg, km)",
        defaultLabel: "Default destination",
        positionLabel: "Application site position",
        descriptionLabel: "Site description",
        includeSoilTemperature: true,
      }),
    },
    {
      title: "Contact information",
      fields: [
        { label: "Contact email", value: customer.contactEmail },
        { label: "Contact phone", value: customer.contactPhone },
      ],
    },
    {
      title: "Business information",
      fields: [
        { label: "Crop type", value: customer.cropType },
        { label: "Address", value: customer.address },
      ],
    },
  ];
}
