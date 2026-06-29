/**
 * TraceabilitySection — the dashboard's traceability hero. One panel that pairs
 * the illustrative custody flow (feedstock → applied, with losses) on top with
 * an interactive map below: the facility hub, its feedstock sources and fields,
 * and the directional legs between them. Replaces the abstract Sankey ribbon and
 * the static site map with a single "see the chain, then follow it" surface.
 *
 * The MapLibre canvas is dynamic-imported (ssr: false) so the renderer stays
 * out of the route bundle.
 */
"use client";

import dynamic from "next/dynamic";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  CreditBatchSankeyData,
} from "@/lib/chain-of-custody/sankey";
import type {
  DashboardMapEdge,
  DashboardMapPoint,
} from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";
import { TraceabilityFlow } from "./traceability-flow";

const MAP_HEIGHT_CLASS = "h-[420px]";

const TraceabilityMap = dynamic(() => import("./traceability-map"), {
  ssr: false,
  loading: () => (
    <div className={`${MAP_HEIGHT_CLASS} animate-pulse bg-[var(--color-surface-light)]`} />
  ),
});

/** Marker + leg legend — squares for sites, line swatches for the flow legs. */
const SITE_LEGEND: { label: string; color: string; diamond?: boolean }[] = [
  { label: "Facility", color: "var(--clr-purple)" },
  { label: "Feedstock source", color: "var(--clr-orange)" },
  { label: "Application field", color: "var(--clr-pink)", diamond: true },
];
const LEG_LEGEND: { label: string; color: string }[] = [
  { label: "Inbound haul", color: "var(--clr-orange)" },
  { label: "Outbound delivery", color: "var(--clr-pink)" },
];

interface TraceabilitySectionProps {
  flow: CreditBatchSankeyData;
  points: DashboardMapPoint[];
  edges: DashboardMapEdge[];
  facilityId: string;
}

export function TraceabilitySection({
  flow,
  points,
  edges,
  facilityId,
}: TraceabilitySectionProps) {
  const siteCount = points.length;

  return (
    <DashboardPanel
      title="Traceability"
      meta={
        siteCount > 0 ? (
          <span className="label-micro text-[var(--color-text-tertiary)]">
            {siteCount} {siteCount === 1 ? "site" : "sites"} · {edges.length}{" "}
            {edges.length === 1 ? "leg" : "legs"}
          </span>
        ) : (
          <span className="label-micro text-[var(--color-text-tertiary)]">
            Chain of custody
          </span>
        )
      }
    >
      <TraceabilityFlow flow={flow} facilityId={facilityId} />

      <div className="border-t border-[var(--color-border-tertiary)]">
        {siteCount === 0 ? (
          <EmptyState
            padding="md"
            icon={<MapTrifoldIcon size={32} />}
            title="No mapped sites yet"
            description="Add GPS to this facility, its feedstock, or its application fields to trace the chain geographically."
          />
        ) : (
          <>
            <div className={`relative ${MAP_HEIGHT_CLASS}`}>
              <TraceabilityMap points={points} edges={edges} />
            </div>
            <div className="flex flex-wrap items-center gap-x-20 gap-y-10 border-t border-[var(--color-border-tertiary)] px-20 py-16">
              {SITE_LEGEND.map((entry) => (
                <span
                  key={entry.label}
                  className="flex items-center gap-8 label-micro text-[var(--color-text-secondary)]"
                >
                  <span
                    className={`h-10 w-10 border border-[var(--clr-dark-purple)] ${
                      entry.diamond ? "rotate-45" : ""
                    }`}
                    style={{ background: entry.color }}
                    aria-hidden
                  />
                  {entry.label}
                </span>
              ))}
              <span className="h-12 w-px bg-[var(--color-border-secondary)]" aria-hidden />
              {LEG_LEGEND.map((entry) => (
                <span
                  key={entry.label}
                  className="flex items-center gap-8 label-micro text-[var(--color-text-secondary)]"
                >
                  <span
                    className="h-[3px] w-16"
                    style={{ background: entry.color }}
                    aria-hidden
                  />
                  {entry.label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </DashboardPanel>
  );
}
