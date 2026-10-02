"use client";

/**
 * The route as every transport surface shows it: a "Route" field label with
 * its CERT chip, a map for a single leg, then the legs on the route rail.
 * Presentational only: the editor wraps it with add/edit/delete, and
 * `TransportRoutePreview` feeds it a caller's own values.
 */
import type { ReactNode } from "react";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import { ServerError } from "@/components/forms";
import { Skeleton } from "@/components/ui/loading-skeleton";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import { TransportJourney } from "./transport-journey";
import { buildJourney, type JourneyLegInput } from "./transport-journey-model";
import { TransportRouteMapButton } from "./transport-route-map";
import type { TransportLegCertSummary } from "./transport-leg-cert-status";

// Feedstock and biochar legs are auto-derived (supplier distance / delivery
// aggregation); sample → lab stays manual. The visible label is "Route";
// these name the route for screen readers.
const DEFAULT_ROUTE_NAMES: Record<TransportEntityTypeValue, string> = {
  feedstock: "Feedstock to processing route",
  biochar: "Biochar distribution route",
  sample: "Sample to lab route",
};

export function TransportRoute({
  entityType,
  legs,
  title,
  cert,
  hideLoad = false,
  emptyMessage,
  loading = false,
  error,
  evidence,
  actions,
  headerAction,
}: {
  entityType: TransportEntityTypeValue;
  legs: readonly JourneyLegInput[];
  /** Override the route's accessible name. Defaults based on entityType. */
  title?: string;
  /** The route's CERT chip; left out where the inputs around it carry their own. */
  cert?: TransportLegCertSummary;
  /** A route before any goods move (an order) has no load to show. */
  hideLoad?: boolean;
  emptyMessage: string;
  loading?: boolean;
  error?: string | null;
  evidence?: (index: number) => boolean | undefined;
  actions?: (index: number) => ReactNode;
  /** Beside the map button, e.g. the editor's Add transport leg. */
  headerAction?: ReactNode;
}) {
  const journey = buildJourney(legs, { hideLoad });
  const mapLeg = journey.legs.length === 1 ? journey.legs[0] : null;

  return (
    <div className="space-y-8">
      {/* Reads as a field label in the step, not a heading: the step title
          already sits on the page's heading ladder. Same style as DetailField. */}
      <div className="flex flex-wrap items-center justify-between gap-8">
        <span className="flex items-center gap-6 body-small text-[var(--color-text-secondary)]">
          Route
          {cert && <CertificationFieldTag status={cert.status} description={cert.description} />}
        </span>
        <span className="flex items-center gap-8">
          {mapLeg && <TransportRouteMapButton leg={mapLeg} entityType={entityType} />}
          {headerAction}
        </span>
      </div>

      {error && <ServerError message={error} />}

      {loading ? (
        <div className="space-y-12" aria-label="Loading transport legs">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-16 w-1/2" />
        </div>
      ) : journey.legs.length === 0 ? (
        <p className="body-small text-[var(--color-text-tertiary)]">{emptyMessage}</p>
      ) : (
        <TransportJourney
          journey={journey}
          label={title ?? DEFAULT_ROUTE_NAMES[entityType]}
          evidence={evidence}
          actions={actions}
        />
      )}
    </div>
  );
}
