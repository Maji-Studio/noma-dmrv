/** Facility side-sheet view mode: the sections config for EntitySideSheet. */
import { formatMass } from "@/lib/format-utils";
import { formatCount } from "@/lib/copy-utils";
import { FacilityCertifierSummary } from "@/components/certification";
import { formatTimezoneLabel } from "@/lib/date-utils";
import { formatDurabilityOption } from "@/schemas/credit-batches";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { FacilityWithRelations } from "@/data-access/facilities";

export function facilitySheetSections(facility: FacilityWithRelations): DetailPanelSection[] {
  return [
    {
      title: "Facility information",
      fields: [
        { label: "Facility name", value: facility.name },
        { label: "Country", value: facility.country },
        { label: "Timezone", value: formatTimezoneLabel(facility.timezone) },
        { label: "Location", value: facility.location },
        { label: "Address", value: facility.address },
        { label: "Facility position latitude", value: facility.gpsLatitude },
        { label: "Facility position longitude", value: facility.gpsLongitude },
        { label: "Contact email", value: facility.contactEmail },
        { label: "Contact phone", value: facility.contactPhone },
        { label: "Durability tier", value: formatDurabilityOption(facility.durabilityOption) },
      ],
    },
    {
      title: "Infrastructure",
      fields: [
        {
          label: "Reactors",
          value: formatCount(facility.reactorCount, "reactor"),
        },
        {
          label: "Feedstock bins",
          value: formatCount(
            facility.storageSummary.feedstockBinCount,
            "bin",
          ),
        },
        {
          label: "Biochar bins",
          value: formatCount(
            facility.storageSummary.biocharBinCount,
            "bin",
          ),
        },
        {
          label: "Product bins",
          value: formatCount(
            facility.storageSummary.productBinCount,
            "bin",
          ),
        },
      ],
    },
    {
      title: "Inventory snapshot",
      fields: [
        {
          label: "Feedstock on hand (wet)",
          value: formatMass(facility.inventorySummary.feedstockWetKg),
        },
        {
          label: "Biochar on hand",
          value: formatMass(facility.inventorySummary.biocharKg),
        },
        {
          label: "Product mass",
          value: formatMass(facility.inventorySummary.productKg),
        },
      ],
    },
    {
      title: "Registry connection",
      fields: [],
      content: <FacilityCertifierSummary facilityId={facility.id} />,
    },
  ];
}
