/** Delivery side-sheet view mode: the sections config for EntitySideSheet. */
import { TRANSPORT_EVIDENCE_HINTS } from "@/components/transport-legs/transport-evidence-hints";
import { TransportEvidencePanel, TransportRoutePreview } from "@/components/transport-legs";
import { distanceReadFields } from "@/components/transport-legs/distance-override";
import { TransportDistanceDriftNotice } from "@/components/transport-legs/transport-distance-drift";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveFacilityTimezone } from "@/lib/date-utils";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { hasAcceptedTransportEvidence } from "@/lib/certification/transport-evidence";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL, qualifyMassLabel, WET_MASS_FIELD_LABEL } from "@/lib/mass-moisture";
import { DeliveryStockDetails } from "./delivery-stock-details";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { DeliveryWithRelations } from "@/data-access/deliveries";

const ROUTE_EMPTY =
  "No route to draw yet. Record the delivered wet mass and a distance to the destination.";

export type DeliverySheetRecord = Omit<DeliveryWithRelations, "proofOfDeliveryCount">;

export function deliverySheetSections(delivery: DeliverySheetRecord, facilities: readonly { id: string; timezone: string }[]): DetailPanelSection[] {
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
      fields: distanceReadFields({
        overrideKm: delivery.distanceKmOverride,
        effectiveKm: delivery.effectiveDistanceKm,
        note: delivery.distanceNote,
        locationName: delivery.destinationName,
        derivedSource: delivery.recordedDistanceSource,
        // Resetting a delivery override restores its recorded pair snapshot.
        locationDefaultKm: delivery.recordedDistanceKm,
      }),
      // The leg this delivery adds to its product's biochar distribution.
      content: (
        <div className="flex flex-col gap-16">
        <TransportDistanceDriftNotice target={{ entityType: "delivery", entityId: delivery.id }} recordCode={delivery.code} />
        <TransportRoutePreview
          entityType="biochar"
          originName={delivery.facilityName}
          destinationName={delivery.destinationName}
          distanceKm={delivery.effectiveDistanceKm}
          distanceSource={delivery.effectiveDistanceSource}
          loadMassKg={delivery.deliveredWetMassKg}
          saved
          evidenceAttached={hasAcceptedTransportEvidence(delivery.transportEvidenceDocumentCount)}
          emptyMessage={ROUTE_EMPTY}
          certTag
          originPoint={{ lat: delivery.facilityGpsLatitude, lng: delivery.facilityGpsLongitude }}
          destinationPoint={{ lat: delivery.destinationGpsLatitude, lng: delivery.destinationGpsLongitude }}
        />
        </div>
      ),
    },
    {
      title: "Delivery evidence",
      hint: TRANSPORT_EVIDENCE_HINTS.delivery,
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
