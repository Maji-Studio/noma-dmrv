"use client";

/**
 * Carbon Viewer overlays — legend, not-geolocated chip box, warning banner,
 * and empty state. Plain React absolutely positioned over the map; all
 * interactions route through onSelectNode so the page can drive both map and
 * DAG highlights.
 */

import type { CSSProperties } from "react";
import type { ChainGeoNode } from "@/data-access/chain-of-custody-geo";
import { cn } from "@/lib/utils";
import { NODE_ACCENT_VAR } from "./viewer-constants";

const RAIL_BOX_CLASS =
  "border-[1.5px] border-[var(--clr-dark-purple-20)] " +
  "bg-[color-mix(in_srgb,var(--color-background-white)_94%,transparent)] backdrop-blur-[8px]";

const RAIL_HEAD_CLASS =
  "flex justify-between gap-8 border-b border-[var(--clr-dark-purple-10)] px-12 py-10 " +
  "font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-[var(--clr-dark-purple-60)]";

// ---------------------------------------------------------------------------
// Legend (top-right) — swatches mirror the marker shapes
// ---------------------------------------------------------------------------

const LEGEND_ROWS = [
  { accent: "var(--acc-prod)", diamond: false, label: "Supplier · feedstock origin" },
  { accent: "var(--acc-infra)", diamond: false, label: "Facility · pyrolysis hub" },
  { accent: "var(--acc-dist)", diamond: true, label: "Application field · stored" },
] as const;

export function ViewerLegend() {
  return (
    <div
      className={`absolute right-16 top-16 z-10 flex flex-col gap-[9px] px-[14px] py-12 ${RAIL_BOX_CLASS}`}
      data-testid="carbon-viewer-legend"
    >
      {LEGEND_ROWS.map((row) => (
        <div
          key={row.label}
          className="flex items-center gap-[9px] font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]"
        >
          <span
            className="size-[9px] shrink-0"
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
// Not geolocated chip box (split view only)
// ---------------------------------------------------------------------------

interface NotGeolocatedChipsProps {
  nodes: ChainGeoNode[];
  onSelectNode: (nodeId: string) => void;
}

export function NotGeolocatedChips({
  nodes,
  onSelectNode,
}: NotGeolocatedChipsProps) {
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
            className="cursor-pointer border-[1.5px] border-current px-[7px] py-4 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] hover:bg-[var(--clr-dark-purple-1)]"
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

/**
 * `className` / `style` place the stack. The default clears the top-left map
 * controls, which is where they sit in split view; map view moves the controls
 * and docks a record panel over that corner, so it positions the banner itself.
 */
export function MapWarningBanner({
  warnings,
  className = "left-[70px] top-16",
  style,
}: {
  warnings: string[];
  className?: string;
  style?: CSSProperties;
}) {
  if (warnings.length === 0) return null;
  return (
    <div
      className={cn("absolute z-10 flex max-w-[320px] flex-col gap-10", className)}
      style={style}
      data-testid="carbon-viewer-warning"
    >
      {warnings.map((warning) => (
        <p
          key={warning}
          className="border-[1.5px] border-dashed border-[var(--clr-red)] bg-[color-mix(in_srgb,var(--color-background-white)_94%,transparent)] px-[14px] py-[11px] font-mono text-[9.5px] uppercase leading-[1.7] tracking-[0.07em] text-[var(--clr-red)] backdrop-blur-[8px]"
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
