"use client";

import type { DistanceSourceValue } from "@/schemas/distance-source";
import type {
  TransportEntityTypeValue,
  TransportLegFormData,
} from "@/schemas/transport-legs";
import { positiveOrNull } from "@/lib/calculations/transport-leg";
import { TransportLegsEditor } from "./transport-legs-editor";

interface TransportRoutePreviewProps {
  /** Route category; names the caption and the CERT requirements. */
  entityType: TransportEntityTypeValue;
  originName: string | null | undefined;
  destinationName: string | null | undefined;
  /** One-way distance; the leg box adds the round trip it counts. */
  distanceKm: number | null | undefined;
  distanceSource: DistanceSourceValue | null | undefined;
  loadMassKg: number | null | undefined;
  /** The values are saved, so the CERT chip may resolve. Leave false for a form draft. */
  saved?: boolean;
  /** Evidence state; left out, the leg draws no evidence icon. */
  evidenceAttached?: boolean;
  /** Shown while there is neither a distance nor a load to draw. */
  emptyMessage: string;
  /** Override the route caption. */
  title?: string;
  /** A route before goods move (an order) has no load to show. */
  plannedRoute?: boolean;
  /** PROTOTYPE: route ends for the map dialog. */
  originPoint?: { lat: number | null; lng: number | null } | null;
  destinationPoint?: { lat: number | null; lng: number | null } | null;
  /** PROTOTYPE: carry the CERT chip on the Route label (read views; forms badge the inputs). */
  showCert?: boolean;
}

/**
 * The one road leg a record moves goods along, drawn from values the caller
 * already holds instead of the saved transport-leg rows. A delivery or a
 * feedstock form being edited shows the same journey the saved leg will.
 */
export function TransportRoutePreview({
  entityType,
  originName,
  destinationName,
  distanceKm,
  distanceSource,
  loadMassKg,
  saved = false,
  evidenceAttached,
  emptyMessage,
  title,
  plannedRoute = false,
  originPoint,
  destinationPoint,
  showCert = false,
}: TransportRoutePreviewProps) {
  const distance = positiveOrNull(distanceKm);
  const load = positiveOrNull(loadMassKg);
  // The journey renders a missing distance or load as "not recorded", which
  // the leg schema's output type does not model; only the editor reads it.
  const legs = distance == null && load == null
    ? []
    : [{
        originName: originName ?? null,
        destinationName: destinationName ?? null,
        distanceKm: distance,
        distanceSource: distance == null ? null : (distanceSource ?? null),
        transportMethodType: "road",
        calculationMethodType: "distance_based",
        loadMassKg: load,
        originGpsLatitude: originPoint?.lat ?? null,
        originGpsLongitude: originPoint?.lng ?? null,
        destinationGpsLatitude: destinationPoint?.lat ?? null,
        destinationGpsLongitude: destinationPoint?.lng ?? null,
      } as unknown as TransportLegFormData];

  return (
    <TransportLegsEditor
      entityType={entityType}
      entityId=""
      previewLegs={legs}
      previewSaved={saved}
      previewEvidenceAttached={evidenceAttached}
      emptyMessage={emptyMessage}
      title={title}
      hideLoad={plannedRoute}
      // Every preview sits inside the step that records the route, under the
      // step title and beside the fields' own CERT chips.
      hideHeader
      routeCert={showCert}
    />
  );
}
