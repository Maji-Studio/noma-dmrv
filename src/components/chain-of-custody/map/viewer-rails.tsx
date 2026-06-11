"use client";

/**
 * Carbon Viewer overlays — legend, transport-legs rail, not-geolocated rail,
 * split-view chip box, warning banner, empty state. Plain React absolutely
 * positioned over the map; all interactions route through onSelectNode so
 * the page can drive both map and DAG highlights.
 */

import type {
  ChainGeoLeg,
  ChainGeoNode,
} from "@/data-access/chain-of-custody-geo";
import { LINEAGE_NODE_STYLES } from "../chain-constants";
import { NODE_ACCENT_VAR } from "./viewer-constants";
import { totalLegDistanceKm } from "./viewer-utils";

const RAIL_BOX_CLASS =
  "border-[1.5px] border-[var(--clr-dark-purple-20)] " +
  "bg-[color-mix(in_srgb,var(--color-background-white)_94%,transparent)] backdrop-blur-[8px]";

const RAIL_HEAD_CLASS =
  "flex justify-between gap-8 border-b border-[var(--clr-dark-purple-10)] px-12 py-10 " +
  "font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-[var(--clr-dark-purple-60)]";

const RAIL_FOOT_CLASS =
  "px-12 py-9 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--clr-dark-purple-40)]";

function legKindLabel(leg: ChainGeoLeg): string {
  return leg.kind === "inbound" ? "feedstock inbound" : "biochar outbound";
}

function nodeKindLabel(node: ChainGeoNode): string {
  return node.kind === "facility"
    ? "Facility"
    : LINEAGE_NODE_STYLES[node.kind].label;
}

// ---------------------------------------------------------------------------
// Legend (bottom-left) — swatches mirror the marker shapes
// ---------------------------------------------------------------------------

const LEGEND_ROWS = [
  { accent: "var(--clr-orange)", diamond: false, label: "Supplier · feedstock origin" },
  { accent: "var(--clr-purple)", diamond: false, label: "Facility · pyrolysis hub" },
  { accent: "var(--clr-pink)", diamond: true, label: "Application field · stored" },
] as const;

export function ViewerLegend() {
  return (
    <div
      className={`absolute bottom-16 left-16 z-10 flex flex-col gap-9 px-14 py-12 ${RAIL_BOX_CLASS}`}
      data-testid="carbon-viewer-legend"
    >
      {LEGEND_ROWS.map((row) => (
        <div
          key={row.label}
          className="flex items-center gap-9 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]"
        >
          <span
            className="size-9 shrink-0"
            style={{
              background: row.accent,
              transform: row.diamond ? "rotate(45deg) scale(0.9)" : undefined,
            }}
            aria-hidden="true"
          />
          {row.label}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transport legs rail
// ---------------------------------------------------------------------------

interface TransportLegsRailProps {
  legs: ChainGeoLeg[];
  /** Highlight the leg's origin-side node (falls back to facility). */
  onSelectLeg: (leg: ChainGeoLeg) => void;
}

export function TransportLegsRail({ legs, onSelectLeg }: TransportLegsRailProps) {
  return (
    <div className={RAIL_BOX_CLASS} data-testid="carbon-viewer-legs-rail">
      <div className={RAIL_HEAD_CLASS}>
        <span>Transport legs</span>
        <span>{totalLegDistanceKm(legs)} km total</span>
      </div>
      {legs.map((leg) => (
        <button
          key={leg.id}
          type="button"
          onClick={() => onSelectLeg(leg)}
          className="flex w-full cursor-pointer items-center gap-10 border-b border-[var(--clr-dark-purple-10)] px-12 py-9 text-left font-mono text-[10px] uppercase tracking-[0.04em] text-[var(--clr-dark-purple)] last:border-b-0 hover:bg-[var(--clr-dark-purple-1)]"
        >
          <span
            className="size-7 shrink-0"
            style={{
              background:
                leg.kind === "inbound" ? "var(--clr-orange)" : "var(--clr-pink)",
            }}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 overflow-hidden">
            <span className="block truncate">
              {leg.originName ?? "Unknown"} → {leg.destinationName ?? "Unknown"}
            </span>
            <span className="mt-2 block truncate text-[8.5px] tracking-[0.06em] text-[var(--clr-dark-purple-40)]">
              {legKindLabel(leg)}
            </span>
          </span>
          <span className="whitespace-nowrap text-[10px] text-[var(--clr-dark-purple-60)]">
            {leg.distanceKm} km
          </span>
        </button>
      ))}
      <div className={RAIL_FOOT_CLASS}>
        Distance drives transport emissions in the carbon accounting.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not geolocated rail (map view) + chip box (split view)
// ---------------------------------------------------------------------------

interface NotGeolocatedProps {
  nodes: ChainGeoNode[];
  facilityCode: string;
  onSelectNode: (nodeId: string) => void;
}

export function NotGeolocatedRail({
  nodes,
  facilityCode,
  onSelectNode,
}: NotGeolocatedProps) {
  return (
    <div className={RAIL_BOX_CLASS} data-testid="carbon-viewer-ungeo-rail">
      <div className={RAIL_HEAD_CLASS}>
        <span>Not geolocated</span>
        <span>{nodes.length}</span>
      </div>
      {nodes.length === 0 ? (
        <div className={RAIL_FOOT_CLASS}>All records carry coordinates.</div>
      ) : (
        <>
          {nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node.id)}
              className="flex w-full cursor-pointer items-center gap-10 border-b border-[var(--clr-dark-purple-10)] px-12 py-9 text-left font-mono text-[10px] uppercase tracking-[0.04em] text-[var(--clr-dark-purple)] last:border-b-0 hover:bg-[var(--clr-dark-purple-1)]"
            >
              <span
                className="size-7 shrink-0"
                style={{ background: NODE_ACCENT_VAR[node.kind] }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block truncate">{node.code}</span>
                <span className="mt-2 block truncate text-[8.5px] tracking-[0.06em] text-[var(--clr-dark-purple-40)]">
                  {nodeKindLabel(node)} · no GPS — inherits facility
                </span>
              </span>
            </button>
          ))}
          <div className={RAIL_FOOT_CLASS}>
            Records without coordinates resolve to {facilityCode}.
          </div>
        </>
      )}
    </div>
  );
}

export function NotGeolocatedChips({
  nodes,
  onSelectNode,
}: Omit<NotGeolocatedProps, "facilityCode">) {
  if (nodes.length === 0) return null;
  return (
    <div
      className={`absolute bottom-16 right-16 z-10 min-w-[232px] max-w-[300px] ${RAIL_BOX_CLASS}`}
      data-testid="carbon-viewer-ungeo-chips"
    >
      <div className={RAIL_HEAD_CLASS}>
        <span>Not geolocated</span>
        <span>{nodes.length}</span>
      </div>
      <div className="flex flex-wrap gap-6 px-12 pb-12 pt-10">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelectNode(node.id)}
            className="cursor-pointer border-[1.5px] border-current px-7 py-4 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] hover:bg-[var(--clr-dark-purple-1)]"
            style={{ color: NODE_ACCENT_VAR[node.kind] }}
          >
            {node.code}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Warning banner + empty state
// ---------------------------------------------------------------------------

export function MapWarningBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div
      className="absolute left-[70px] top-16 z-10 flex max-w-[320px] flex-col gap-10"
      data-testid="carbon-viewer-warning"
    >
      {warnings.map((warning) => (
        <p
          key={warning}
          className="border-[1.5px] border-dashed border-[var(--clr-red)] bg-[color-mix(in_srgb,var(--color-background-white)_94%,transparent)] px-14 py-11 font-mono text-[9.5px] uppercase leading-[1.7] tracking-[0.07em] text-[var(--clr-red)] backdrop-blur-[8px]"
        >
          {warning}
        </p>
      ))}
    </div>
  );
}

export function ViewerEmptyState({ message }: { message: string }) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-18 bg-[var(--color-background-white)] text-center"
      data-testid="carbon-viewer-empty"
    >
      <p className="text-[34px] font-thin tracking-[-0.01em] text-[var(--color-text-primary)]">
        Nothing to plot.
      </p>
      <p className="max-w-[42ch] font-mono text-[11px] uppercase leading-[1.8] tracking-[0.1em] text-[var(--clr-dark-purple-40)]">
        {message}
      </p>
    </div>
  );
}
