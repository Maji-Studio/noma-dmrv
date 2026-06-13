/**
 * MapPreview — the dashboard's site map panel: the facility, its application
 * fields, and feedstock sources plotted on the Carbon Viewer basemap, with a
 * colour legend. The MapLibre canvas is dynamic-imported (ssr: false) so the
 * renderer stays out of the route bundle.
 */
"use client";

import dynamic from "next/dynamic";
import { MapTrifold } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  DashboardMapKind,
  DashboardMapPoint,
} from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";

const MAP_HEIGHT_CLASS = "h-[360px]";

const DashboardMap = dynamic(() => import("./dashboard-map"), {
  ssr: false,
  loading: () => (
    <div className={`${MAP_HEIGHT_CLASS} animate-pulse bg-[var(--color-surface-light)]`} />
  ),
});

const LEGEND: { kind: DashboardMapKind; label: string; color: string }[] = [
  { kind: "facility", label: "Facility", color: "var(--clr-purple)" },
  { kind: "feedstock", label: "Feedstock source", color: "var(--clr-orange)" },
  { kind: "application", label: "Application field", color: "var(--clr-pink)" },
];

interface MapPreviewProps {
  points: DashboardMapPoint[];
}

export function MapPreview({ points }: MapPreviewProps) {
  const present = new Set(points.map((point) => point.kind));

  return (
    <DashboardPanel
      title="Site map"
      meta={
        points.length > 0 ? (
          <span className="label-micro text-[var(--color-text-tertiary)]">
            {points.length} {points.length === 1 ? "site" : "sites"}
          </span>
        ) : undefined
      }
    >
      {points.length === 0 ? (
        <EmptyState
          padding="md"
          icon={<MapTrifold size={32} />}
          title="No mapped sites yet"
          description="Add GPS to this facility, its feedstock, or its application fields to see them here."
        />
      ) : (
        <>
          <div className={`relative ${MAP_HEIGHT_CLASS}`}>
            <DashboardMap points={points} />
          </div>
          <div className="flex flex-wrap items-center gap-x-20 gap-y-8 border-t border-[var(--color-border-tertiary)] px-20 py-12">
            {LEGEND.map((entry) => (
              <span
                key={entry.kind}
                className={`flex items-center gap-8 label-micro ${
                  present.has(entry.kind)
                    ? "text-[var(--color-text-secondary)]"
                    : "text-[var(--color-text-tertiary)] opacity-50"
                }`}
              >
                <span
                  className="h-10 w-10 border border-[var(--clr-dark-purple)]"
                  style={{ background: entry.color }}
                  aria-hidden
                />
                {entry.label}
              </span>
            ))}
          </div>
        </>
      )}
    </DashboardPanel>
  );
}
