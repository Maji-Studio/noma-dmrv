/** Facility side-sheet view mode: the sections config for EntitySideSheet. */
import { formatCount, LOAD_FAILED } from "@/lib/copy-utils";
import { formatMass } from "@/lib/format-utils";
import { FacilityCertifierSummary } from "@/components/certification";
import { formatTimezoneLabel } from "@/lib/date-utils";
import { formatDurabilityOption } from "@/schemas/credit-batches";
import type { DetailPanelField, DetailPanelSection } from "@/components/ui/detail-panel";
import type { FacilityWithRelations } from "@/data-access/facilities";
import type { FacilityOutputStock, FacilityOutputStockGroup } from "@/data-access/facility-output-stock";
import { facilityStockFigure } from "@/components/storage-locations/stock-preview-shared";

/** The facility's output-bin stock query, as the sheet needs it. */
export interface FacilityStockState {
  data?: FacilityOutputStock;
  isPending: boolean;
  isError: boolean;
}

const WET_ESTIMATE_HINT = "Estimated: the wet mass is computed at each batch's moisture. A bin without a wet estimate shows its dry biochar instead.";

/**
 * One output-bin row. A row is left out once the read settled without a
 * derivable figure; while there is no data it loads or says why it failed.
 */
function stockRow(label: string, scope: string, group: FacilityOutputStockGroup | null | undefined, state: FacilityStockState | undefined): DetailPanelField[] {
  const hint = `${WET_ESTIMATE_HINT} Sum of this facility's ${scope}, archived bins included.`;
  if (group) {
    return [{
      label, hint, value: facilityStockFigure(group.wetKg, group.dryBiocharKg),
      secondary: group.wetKg === null ? undefined : { label: "Dry biochar", value: formatMass(group.dryBiocharKg) },
    }];
  }
  if (group === null) return [];
  if (state?.isError) return [{ label, hint, value: LOAD_FAILED, valuePresent: false }];
  return [{ label, hint, value: null, pending: true }];
}

export function facilitySheetSections(facility: FacilityWithRelations, stock?: FacilityStockState): DetailPanelSection[] {
  const biochar = stockRow("Biochar in bins", "biochar bins", stock?.data?.biochar, stock);
  const product = stockRow("Products in bins", "product bins", stock?.data?.product, stock);
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
          label: "Feedstock in bins",
          value: `${formatMass(facility.inventorySummary.feedstockWetKg)} wet mass`,
        },
        ...biochar,
        ...product,
      ],
    },
    {
      title: "Registry connection",
      fields: [],
      content: <FacilityCertifierSummary facilityId={facility.id} />,
    },
  ];
}
