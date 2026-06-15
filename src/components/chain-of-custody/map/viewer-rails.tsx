"use client";

/**
 * Carbon Viewer overlays — legend, transport-legs rail, not-geolocated rail,
 * split-view chip box, warning banner, empty state. Plain React absolutely
 * positioned over the map; all interactions route through onSelectNode so
 * the page can drive both map and DAG highlights.
 */

import { CaretRight, Factory, Truck, X } from "@phosphor-icons/react/dist/ssr";
import type {
  ChainGeoLeg,
  ChainGeoNode,
} from "@/data-access/chain-of-custody-geo";
import { formatDistanceKm } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import {
  FOCUS_DIM_OPACITY,
  NODE_ACCENT_VAR,
  RAIL_CARD_WIDTH_PX,
} from "./viewer-constants";
import { totalLegDistanceKm } from "./viewer-utils";

function legAccent(leg: ChainGeoLeg): string {
  return leg.kind === "inbound" ? "var(--acc-prod)" : "var(--acc-dist)";
}

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
// Transport legs bar (map view) — directional schematic: feedstock inbound
// (left wing) → facility hub (center pivot) → biochar outbound (right wing).
// One continuous edge-to-edge element. Clicking a leg card focuses that
// sub-chain across bar + map + DAG; clicking the hub clears the focus.
// ---------------------------------------------------------------------------

/** Per-card focus treatment: no focus active, focused (figure), or dimmed. */
type LegFocusState = "none" | "in" | "out";

function legFocusState(
  legId: string,
  focusLegIds: Set<string> | null
): LegFocusState {
  if (focusLegIds === null) return "none";
  return focusLegIds.has(legId) ? "in" : "out";
}

interface LegCardProps {
  leg: ChainGeoLeg;
  /** Facility name — folds back into the hover tooltip's full route. */
  facilityName: string;
  focusState: LegFocusState;
  onFocus: (leg: ChainGeoLeg) => void;
}

/**
 * One transport hop. The card drops the redundant facility endpoint (the hub
 * already names it) and shows only the outer party — supplier for inbound,
 * field for outbound — truncated, with the full route restored on hover.
 */
function LegCard({ leg, facilityName, focusState, onFocus }: LegCardProps) {
  const accent = legAccent(leg);
  const outerName =
    (leg.kind === "inbound" ? leg.originName : leg.destinationName) ?? "Unknown";
  const fullRoute =
    leg.kind === "inbound"
      ? `${outerName} → ${facilityName}`
      : `${facilityName} → ${outerName}`;

  return (
    <Tooltip content={`${fullRoute} · ${formatDistanceKm(leg.distanceKm)}`}>
      <button
        type="button"
        onClick={() => onFocus(leg)}
        aria-pressed={focusState === "in"}
        data-testid="carbon-viewer-leg-card"
        className={cn(
          "flex shrink-0 cursor-pointer flex-col justify-center gap-[7px] py-[14px] pl-12 pr-[14px] text-left transition-[opacity,background-color] hover:bg-[var(--clr-dark-purple-1)]",
          focusState === "in" && "bg-[var(--clr-dark-purple-5)]"
        )}
        style={{
          width: RAIL_CARD_WIDTH_PX,
          opacity: focusState === "out" ? FOCUS_DIM_OPACITY : 1,
          // Colored channel down the card's leading edge — its node accent,
          // tying each hop to its marker on the map and the legend.
          borderLeft: `${focusState === "in" ? 3 : 2}px solid ${accent}`,
        }}
      >
        <span className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.02em] text-[var(--clr-dark-purple)]">
          {outerName}
        </span>
        <span className="flex items-center gap-[5px] font-mono text-[10px] tracking-[0.02em] text-[var(--clr-dark-purple-60)]">
          <Truck
            size={12}
            className="shrink-0 text-[var(--clr-dark-purple-40)]"
            aria-hidden="true"
          />
          {formatDistanceKm(leg.distanceKm)}
        </span>
      </button>
    </Tooltip>
  );
}

interface LegWingProps {
  kind: "inbound" | "outbound";
  legs: ChainGeoLeg[];
  facilityName: string;
  focusLegIds: Set<string> | null;
  onFocusLeg: (leg: ChainGeoLeg) => void;
}

/**
 * One side of the bar. Inbound hugs the hub from the left, outbound from the
 * right (common case is 1–3 legs a side; the card row scrolls past that).
 */
function LegWing({
  kind,
  legs,
  facilityName,
  focusLegIds,
  onFocusLeg,
}: LegWingProps) {
  const toHub = kind === "inbound" ? "justify-end" : "justify-start";
  const accent = kind === "inbound" ? "var(--acc-prod)" : "var(--acc-dist)";
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div
        className={cn(
          "flex items-center gap-[5px] border-b border-[var(--clr-dark-purple-10)] px-12 py-[7px] font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-[var(--clr-dark-purple-40)]",
          toHub
        )}
      >
        <span
          className="size-[6px] shrink-0"
          style={{ background: accent }}
          aria-hidden="true"
        />
        <span>{kind === "inbound" ? "Feedstock in" : "Biochar out"}</span>
        <span className="text-[var(--clr-dark-purple-30)]">{legs.length}</span>
      </div>
      {legs.length === 0 ? (
        <div
          className={cn(
            "flex flex-1 items-center px-12 py-12 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--clr-dark-purple-30)]",
            toHub
          )}
        >
          None recorded
        </div>
      ) : (
        <div className={cn("flex min-w-0 flex-1 overflow-x-auto", toHub)}>
          {legs.map((leg) => (
            <LegCard
              key={leg.id}
              leg={leg}
              facilityName={facilityName}
              focusState={legFocusState(leg.id, focusLegIds)}
              onFocus={onFocusLeg}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Static flow connector — a hairline rail + chevron echoing the map's transit
 * lines. Reads left → hub → right; the second chevron points the same way so
 * the whole bar scans as one directed pipeline.
 */
function RailConnector() {
  return (
    <div
      className="flex shrink-0 items-center gap-[3px] px-8 text-[var(--clr-dark-purple-30)]"
      aria-hidden="true"
    >
      <span className="h-px w-10 bg-[var(--clr-dark-purple-20)]" />
      <CaretRight size={12} weight="bold" />
    </div>
  );
}

interface FacilityHubProps {
  facility: { code: string; name: string };
  totalKm: number;
  inCount: number;
  outCount: number;
  focusActive: boolean;
  onClearFocus: () => void;
}

/**
 * Center pivot. Largely non-interactive — its one action is clearing the focus
 * (reset to all-shown), enabled only while a focus is active.
 */
function FacilityHub({
  facility,
  totalKm,
  inCount,
  outCount,
  focusActive,
  onClearFocus,
}: FacilityHubProps) {
  return (
    <button
      type="button"
      disabled={!focusActive}
      onClick={onClearFocus}
      data-testid="carbon-viewer-hub"
      aria-label={focusActive ? "Clear focus" : `Facility ${facility.code}`}
      className={cn(
        "flex shrink-0 flex-col items-center justify-center gap-6 border-x-[1.5px] border-[var(--clr-dark-purple-20)] px-[22px] py-12 text-center transition-[filter]",
        focusActive ? "cursor-pointer hover:brightness-[0.97]" : "cursor-default"
      )}
      style={{
        // The pivot reads as the structural anchor — a faint pyrolysis-purple
        // ground lifts it off the paper wings on either side.
        background:
          "color-mix(in srgb, var(--clr-purple) 8%, var(--color-background-white))",
      }}
    >
      <span className="flex items-center gap-8">
        <span
          className="flex size-[26px] shrink-0 items-center justify-center"
          style={{ background: "var(--acc-infra)" }}
          aria-hidden="true"
        >
          <Factory
            size={15}
            weight="fill"
            className="text-[var(--color-background-white)]"
          />
        </span>
        <span className="flex min-w-0 flex-col items-start">
          <span className="font-mono text-[13px] font-medium leading-none tracking-[0.02em] text-[var(--clr-dark-purple)]">
            {facility.code}
          </span>
          <span className="mt-[3px] max-w-[160px] truncate font-mono text-[8.5px] uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]">
            {facility.name}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-6 whitespace-nowrap font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]">
        <span>{inCount} in</span>
        <span className="text-[var(--clr-dark-purple-20)]">·</span>
        <span>{outCount} out</span>
        <span className="text-[var(--clr-dark-purple-20)]">·</span>
        <span className="text-[var(--clr-dark-purple)]">
          {formatDistanceKm(totalKm)}
        </span>
      </span>
      {focusActive ? (
        <span className="flex items-center gap-[3px] border border-[var(--acc-dist-ink)] px-[7px] py-[2px] font-mono text-[8px] font-medium uppercase tracking-[0.1em] text-[var(--acc-dist-ink)]">
          <X size={8} weight="bold" aria-hidden="true" /> Clear
        </span>
      ) : null}
    </button>
  );
}

interface TransportLegsRailProps {
  legs: ChainGeoLeg[];
  facility: { code: string; name: string };
  /** Leg ids in the active focus sub-chain; null = nothing focused. */
  focusLegIds: Set<string> | null;
  /** Focus a leg's sub-chain (sets the shared selection upstream). */
  onFocusLeg: (leg: ChainGeoLeg) => void;
  /** Clear the active focus (hub click). */
  onClearFocus: () => void;
}

/**
 * The directional transport bar: inbound wing → facility hub → outbound wing,
 * one continuous element pinned along the bottom of the map view.
 */
export function TransportLegsRail({
  legs,
  facility,
  focusLegIds,
  onFocusLeg,
  onClearFocus,
}: TransportLegsRailProps) {
  if (legs.length === 0) return null;
  const inbound = legs.filter((leg) => leg.kind === "inbound");
  const outbound = legs.filter((leg) => leg.kind === "outbound");

  return (
    <div
      className={`flex items-stretch overflow-hidden ${RAIL_BOX_CLASS}`}
      data-testid="carbon-viewer-legs-rail"
    >
      <LegWing
        kind="inbound"
        legs={inbound}
        facilityName={facility.name}
        focusLegIds={focusLegIds}
        onFocusLeg={onFocusLeg}
      />
      <RailConnector />
      <FacilityHub
        facility={facility}
        totalKm={totalLegDistanceKm(legs)}
        inCount={inbound.length}
        outCount={outbound.length}
        focusActive={focusLegIds !== null}
        onClearFocus={onClearFocus}
      />
      <RailConnector />
      <LegWing
        kind="outbound"
        legs={outbound}
        facilityName={facility.name}
        focusLegIds={focusLegIds}
        onFocusLeg={onFocusLeg}
      />
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
