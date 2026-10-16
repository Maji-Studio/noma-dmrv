/** Feedstock delivery side-sheet view mode: the sections config for EntitySideSheet. */
import { TRANSPORT_EVIDENCE_HINTS } from "@/components/transport-legs/transport-evidence-hints";
import { formatCalendarDate, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL } from "@/lib/mass-moisture";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { TransportEvidencePanel, TransportLegsSummary } from "@/components/transport-legs";
import { distanceReadFields, isOverrideDistance } from "@/components/transport-legs/distance-override";
import { TransportDistanceDriftNotice } from "@/components/transport-legs/transport-distance-drift";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";

/** The derived leg's recorded distance, read beside the record (the drift read). */
export interface FeedstockRecordedDistance {
  distanceKm: number | null | undefined;
  pending: boolean;
}

export function feedstockSheetSections(
  feedstock: FeedstockWithRelations,
  recordedDistance: FeedstockRecordedDistance = { distanceKm: null, pending: false },
): DetailPanelSection[] {
  const overrideKm = feedstock.distanceKmOverride;
  const overridden = isOverrideDistance(overrideKm);
  return [
    {
      title: "Delivery information",
      fields: [
        { label: "Delivery date", value: formatCalendarDate(feedstock.deliveryDate) },
        { label: "Supplier", value: feedstock.supplierName },
      ],
    },
    {
      title: "Transport details",
      fields: [
        { label: "Vehicle", value: feedstock.vehiclePlateNumber },
        ...distanceReadFields({
          overrideKm,
          effectiveKm: overridden ? overrideKm : recordedDistance.distanceKm,
          note: feedstock.distanceNote,
          pending: !overridden && recordedDistance.pending,
        }),
      ],
      // The saved leg reads in the step that records it, as on the form.
      content: (
        <div className="flex flex-col gap-16">
          <TransportDistanceDriftNotice target={{ entityType: "feedstock", entityId: feedstock.id }} recordCode={feedstock.code} />
          <TransportLegsSummary entityType="feedstock" entityId={feedstock.id} />
        </div>
      ),
    },
    {
      title: "Material",
      fields: [
        { label: "Feedstock type", value: feedstock.feedstockTypeName },
        {
          label: "Total wet mass (kg)",
          value: formatMassKg(feedstock.massWetKg),
        },
        {
          label: MOISTURE_FIELD_LABEL,
          value: formatMoisturePercent(feedstock.moistureContentPercent),
        },
      ],
      content: (
        <MoistureSplit
          wetMassKg={feedstock.massWetKg}
          moisturePercent={feedstock.moistureContentPercent}
          dryMassKg={feedstock.massDryKg}
          materialLabel="Feedstock"
        />
      ),
    },
    {
      title: "Bin allocations",
      fields: [
        { label: "Storage bin", value: feedstock.storageLocationCode ?? feedstock.storageLocationName },
        { label: "Allocated wet mass (kg)", value: formatMassKg(feedstock.massWetKg) },
        { label: "Over-allocation justification", value: feedstock.overrideJustification },
      ],
    },
    {
      title: "Documentation",
      fields: [{ label: "Notes", value: feedstock.notes }],
    },
    {
      title: "Transport evidence",
      hint: TRANSPORT_EVIDENCE_HINTS.feedstock,
      fields: [],
      content: (
        <TransportEvidencePanel
          entityType="feedstock"
          entityId={feedstock.id}
          readOnly
          embedded
        />
      ),
    },
  ];
}
