/** Feedstock delivery side-sheet view mode: the sections config for EntitySideSheet. */
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { formatDate, formatLegDistanceKm, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL } from "@/lib/mass-moisture";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { TransportEvidencePanel, TransportLegsSummary } from "@/components/transport-legs";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { FeedstockWithRelations } from "@/data-access/feedstocks";

export function feedstockSheetSections(feedstock: FeedstockWithRelations): DetailPanelSection[] {
  return [
    {
      title: "Delivery information",
      fields: [
        { label: "Delivery date", value: formatDate(feedstock.deliveryDate) },
        { label: "Supplier", value: feedstock.supplierName },
      ],
    },
    {
      title: "Transport details",
      fields: [
        { label: "Vehicle", value: feedstock.vehiclePlateNumber },
        {
          label: "Distance",
          ...certificationDetailField("feedstock", "transportDistanceKm"),
          // Status from the raw column, not the formatted string — the
          // "Not recorded" fallback is truthy and would falsely read as satisfied.
          certifyStatus: resolveCertFieldStatus(
            true,
            feedstock.transportDistanceKm !== null,
          ),
          value:
            feedstock.transportDistanceKm !== null
              ? formatLegDistanceKm(feedstock.transportDistanceKm)
              : null,
        },
        {
          label: "Distance source",
          value: feedstock.transportDistanceSource
            ? DISTANCE_SOURCE_LABELS[feedstock.transportDistanceSource]
            : null,
        },
      ],
    },
    {
      title: "Material",
      fields: [
        { label: "Feedstock type", value: feedstock.feedstockTypeName },
        {
          label: "Total wet mass (kg)",
          ...certificationDetailField("feedstock", "massWetKg"),
          certifyStatus: resolveCertFieldStatus(true, feedstock.massWetKg !== null),
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
    {
      title: "Derived transport",
      fields: [],
      content: <TransportLegsSummary entityType="feedstock" entityId={feedstock.id} />,
    },
  ];
}
