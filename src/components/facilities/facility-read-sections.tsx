/** Facility side-sheet view mode: the sections config for EntitySideSheet. */
import { formatCount, LOAD_FAILED } from "@/lib/copy-utils";
import { formatMassKg } from "@/lib/format-utils";
import { FacilityCertifierSummary } from "@/components/certification";
import { formatTimezoneLabel } from "@/lib/date-utils";
import { formatDurabilityOption } from "@/schemas/credit-batches";
import type { DetailPanelField, DetailPanelSection } from "@/components/ui/detail-panel";
import type { FacilityWithRelations } from "@/data-access/facilities";
import type { FacilityOutputStock, FacilityOutputStockGroup } from "@/data-access/facility-output-stock";
import { outputStockFigure } from "@/components/storage-locations/stock-preview-shared";

/** The facility's output-bin stock query, as the sheet needs it. */
export interface FacilityStockState {
  data?: FacilityOutputStock;
  isPending: boolean;
  isError: boolean;
}


/**
 * One output-bin row. A row is left out once the read settled without a
 * derivable figure; while there is no data it loads or says why it failed.
 */
function stockRow(label: string, scope: string, group: FacilityOutputStockGroup | null | undefined, state: FacilityStockState | undefined): DetailPanelField[] {
  const hint = (wet: boolean) => wet
    ? `Estimated wet mass at each batch's moisture. Sum of this facility's ${scope}, archived bins included.`
    : `A bin here has no wet estimate, so this is the dry biochar sum of this facility's ${scope}, archived bins included.`;
  if (group) {
    return [{
      label, hint: hint(group.wetKg !== null), value: outputStockFigure(group.wetKg, group.dryBiocharKg),
      secondary: group.wetKg === null ? undefined : { label: "Dry biochar", value: formatMassKg(group.dryBiocharKg) },
    }];
  }
  const loadingHint = hint(true);
  if (group === null) return [];
  if (state?.isError) return [{ label, hint: loadingHint, value: LOAD_FAILED, valuePresent: false }];
  return [{ label, hint: loadingHint, value: null, pending: true }];
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
          value: `${formatMassKg(facility.inventorySummary.feedstockWetKg)} wet mass`,
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
