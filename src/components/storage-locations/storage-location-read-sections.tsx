/** Storage bin side-sheet view mode: the sections config for EntitySideSheet. */
import { Button } from "@/components/ui";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { formatStorageLocationType, OUTPUT_STOCK_MODE_LABELS } from "@/schemas/storage-locations";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { BinMovementHistoryModal } from "./bin-movement-history-modal";
import { OutputBinBalance } from "./output-bin-balance";
import { OutputStockHistory } from "./output-stock-history";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";

function formatDateOrFallback(value: Date | null) {
  if (!value) return "No completed applications";
  return formatDate(value);
}

/**
 * Per-bin figures are fixed kg (`formatMassKg`) on every branch and in the card
 * that opens this sheet — capacity, stock, allocations and movement deltas are
 * read against each other, and auto-tonne would round a wet/dry pair to the
 * same string. Facility-wide roll-ups (the KPI strip, the lane headers) stay on
 * auto-tonne `formatMass`.
 */
function buildStorageDetailFields(storageLocation: StorageLocationWithFacility) {
  if (storageLocation.type === "feedstock_bin") {
    return [
      {
        label: "Current wet stock",
        value: formatMassKg(storageLocation.feedstockInventory.currentWetMassKg),
      },
      ...(storageLocation.feedstockInventory.pendingWetMassKg > 0
        ? [
            {
              label: "Pending intake (wet)",
              value: formatMassKg(storageLocation.feedstockInventory.pendingWetMassKg),
            },
            {
              label: "Pending feedstocks",
              value: String(storageLocation.feedstockInventory.pendingBatchCount),
            },
          ]
        : []),
      {
        label: "Estimated dry mass (non-binding)",
        value: formatMassKg(storageLocation.feedstockInventory.estimatedDryMassKg),
      },
      {
        label: "Estimated moisture",
        value: formatMoisturePercent(storageLocation.feedstockInventory.estimatedMoisturePercent),
      },
      {
        label: "Feedstock types",
        value:
          storageLocation.feedstockInventory.feedstockTypes.join(", ") || null,
        emptySituation: "none" as const,
      },
    ];
  }

  if (storageLocation.type === "biochar_bin") {
    return [
      {
        // Lifetime running total, never decremented — qualified so it cannot
        // be read as stock still on hand next to "Available biochar"
        // (DR-002 / BB-26-001).
        label: "Allocated to products, all time",
        value: formatMassKg(storageLocation.biocharInventory.allocatedToProductsKg),
      },
      {
        label: "Production runs",
        value: String(storageLocation.biocharInventory.productionRunCount),
      },
      {
        label: "Downstream formulations",
        value:
          storageLocation.biocharInventory.downstreamFormulations.join(", ") || null,
        emptySituation: "none" as const,
      },
    ];
  }

  return [
    {
      // Lifetime running total of source biochar across every product ever
      // stored here, never decremented on delivery — qualified so it cannot
      // be read as stock still on hand next to "Current product mass"
      // (DR-002 / PB-26-001).
      label: "Biochar received, all time",
      value: formatMassKg(storageLocation.productInventory.biocharEquivalentKg),
    },
    {
      label: "Product batches",
      value: String(storageLocation.productInventory.batchCount),
    },
    {
      // Dry basis, unlike the as-is masses above it — the label has to say so.
      label: "Applied, dry",
      value:
        storageLocation.productInventory.appliedApplicationCount > 0
          ? formatMassKg(storageLocation.productInventory.appliedDryMassKg)
          : "No completed applications",
    },
    {
      label: "Applied events",
      value: String(storageLocation.productInventory.appliedApplicationCount),
    },
    {
      label: "Last application",
      value: formatDateOrFallback(storageLocation.productInventory.lastAppliedAt),
    },
    {
      label: "Formulations",
      value:
        storageLocation.productInventory.formulationNames.join(", ") || null,
      emptySituation: "none" as const,
    },
  ];
}

export function storageLocationSheetSections(bin: StorageLocationWithFacility, onReconcile: (bin: StorageLocationWithFacility, kind?: "loss" | "count") => void): DetailPanelSection[] {
  return [
    {
      title: "Storage details",
      fields: [
        {
          label: "Storage type",
          value: formatStorageLocationType(bin.type),
        },
        { label: "Bin name", value: bin.name },
        {
          // Capacity and the current mass below it are the canonical
          // related pair — same formatter, so "1,800 kg of 2,500 kg"
          // never reads as "1,800 kg of 2.5 t".
          label: "Capacity",
          value: bin.capacityKg != null
            ? formatMassKg(bin.capacityKg)
            : null,
        },
        {
          label: "Storage method",
          value: bin.storageMethod,
        },
        ...(bin.type === "feedstock_bin"
          ? [{ label: "Feedstock type", value: bin.feedstockTypeName }]
          : []),
        ...(bin.type === "product_bin"
          ? [{ label: "Formulation", value: bin.formulationName }]
          : []),
        ...(bin.type !== "feedstock_bin"
          ? [{ label: "Stock mode", value: OUTPUT_STOCK_MODE_LABELS[bin.stockMode] }]
          : []),
        { label: "Description", value: bin.storageDescription },
      ],
    },
    {
      title: "Inventory",
      fields: buildStorageDetailFields(bin),
      content: (
        <div className="flex flex-col gap-16">
          {bin.type !== "feedstock_bin" && <Button variant="default" onClick={() => onReconcile(bin, "loss")}>Record loss</Button>}
          <Button
            variant="default"
            onClick={() => onReconcile(bin)}
          >
            <ArrowsClockwiseIcon size={18} weight="bold" />
            Reconcile stock
          </Button>
          {bin.type === "feedstock_bin" ? <BinMovementHistoryModal compact triggerLabel="Stock history" storageLocationId={bin.id} /> : <><OutputBinBalance storageLocationId={bin.id} facilityId={bin.facilityId} /><OutputStockHistory compact triggerLabel="Stock history" storageLocationId={bin.id} facilityId={bin.facilityId} /></>}
        </div>
      ),
    },
  ];
}
