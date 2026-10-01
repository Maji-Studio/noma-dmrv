/** Delivery side-sheet view mode: the sections config for EntitySideSheet. */
import { TransportEvidencePanel } from "@/components/transport-legs";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveFacilityTimezone } from "@/lib/date-utils";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { formatFacilityDateTime, formatLegDistanceKm, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL, qualifyMassLabel, WET_MASS_FIELD_LABEL } from "@/lib/mass-moisture";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
import { DeliveryStockDetails } from "./delivery-stock-details";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { DeliveryWithRelations } from "@/data-access/deliveries";

export function deliverySheetSections(delivery: DeliveryWithRelations, facilities: readonly { id: string; timezone: string }[]): DetailPanelSection[] {
  return [
    {
      title: "Delivery information",
      fields: [
        { label: "Delivery date and time", value: formatFacilityDateTime(delivery.deliveryDate, resolveFacilityTimezone(facilities, delivery.facilityId)) },
        { label: "Status", value: <StatusBadge status={delivery.status} /> },
        { label: "Order", value: delivery.orderCode },
      ],
    },
    {
      title: "Mass and moisture",
      fields: [
        {
          label: qualifyMassLabel(
            WET_MASS_FIELD_LABEL,
            "Biochar product",
          ),
          ...certificationDetailField("delivery", "deliveredWetMassKg"),
          value: formatMassKg(delivery.deliveredWetMassKg),
        },
        {
          label: qualifyMassLabel(
            MOISTURE_FIELD_LABEL,
            "Biochar product",
          ),
          value: formatMoisturePercent(delivery.moistureContentPercent),
        },
      ],
      content: (
        <DeliveryStockDetails deliveryId={delivery.id} storageLocationId={delivery.storageLocationId} wetMassKg={delivery.deliveredWetMassKg} dryMassKg={delivery.massDryKg} />
      ),
    },
    {
      title: "Transport",
      fields: [
        { label: "Distance", value: formatLegDistanceKm(delivery.effectiveDistanceKm) },
        ...(delivery.distanceKmOverride != null
          ? [{ label: "Distance note", value: delivery.distanceNote }]
          : []),
        {
          label: "Distance source",
          value: delivery.effectiveDistanceSource
            ? DISTANCE_SOURCE_LABELS[delivery.effectiveDistanceSource]
            : null,
        },
      ],
    },
    {
      title: "Delivery evidence",
      fields: [],
      content: (
        <TransportEvidencePanel
          entityType="delivery"
          entityId={delivery.id}
          readOnly
          embedded
        />
      ),
    },
  ];
}
