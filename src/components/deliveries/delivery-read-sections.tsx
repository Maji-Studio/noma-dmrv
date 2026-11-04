/** Delivery side-sheet view mode: the sections config for EntitySideSheet. */
import { TRANSPORT_EVIDENCE_HINTS } from "@/components/transport-legs/transport-evidence-hints";
import { TransportEvidencePanel, TransportRoutePreview } from "@/components/transport-legs";
import { distanceReadFields } from "@/components/transport-legs/distance-override";
import { TransportDistanceDriftNotice } from "@/components/transport-legs/transport-distance-drift";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveFacilityTimezone } from "@/lib/date-utils";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";
import { certificationDetailField, isCertifyEntityField } from "@/lib/certification/certify-field-registry";
import { hasAcceptedTransportEvidence } from "@/lib/certification/transport-evidence";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent, MOISTURE_FIELD_LABEL, qualifyMassLabel, WET_MASS_FIELD_LABEL } from "@/lib/mass-moisture";
import { DeliveryStockDetails } from "./delivery-stock-details";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { DeliveryWithRelations } from "@/data-access/deliveries";

const ROUTE_EMPTY =
  "No route to draw yet. Record the delivered wet mass and a distance to the destination.";

export type DeliverySheetRecord = Omit<DeliveryWithRelations, "proofOfDeliveryCount">;

/** `proofStatus` is the saved proof-of-delivery state of the record: neutral until its files load. */
export function deliverySheetSections(
  delivery: DeliverySheetRecord,
  facilities: readonly { id: string; timezone: string }[],
  proofStatus: CertFieldStatus = "neutral",
  /** Read only (a link into an archived facility): no write actions. */
  options: { readOnly?: boolean } = {},
): DetailPanelSection[] {
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
        certify: certificationDetailField("delivery", "effectiveDistanceKm"),
      }),
      // The leg this delivery adds to its product's biochar distribution.
      content: (
        <div className="flex flex-col gap-16">
        <TransportDistanceDriftNotice target={{ entityType: "delivery", entityId: delivery.id }} recordCode={delivery.code} readOnly={options.readOnly} />
        <TransportRoutePreview
          entityType="biochar"
          originName={delivery.facilityName}
          destinationName={delivery.destinationName}
          distanceKm={delivery.effectiveDistanceKm}
          distanceSource={delivery.effectiveDistanceSource}
          loadMassKg={delivery.deliveredWetMassKg}
          evidenceAttached={hasAcceptedTransportEvidence(delivery.transportEvidenceDocumentCount)}
          emptyMessage={ROUTE_EMPTY}
          originPoint={{ lat: delivery.facilityGpsLatitude, lng: delivery.facilityGpsLongitude }}
          destinationPoint={{ lat: delivery.destinationGpsLatitude, lng: delivery.destinationGpsLongitude }}
        />
        </div>
      ),
    },
    {
      title: "Delivery evidence",
      hint: TRANSPORT_EVIDENCE_HINTS.delivery,
      certifyRequired: isCertifyEntityField("delivery", "proofOfDelivery"),
      certifyStatus: proofStatus,
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
