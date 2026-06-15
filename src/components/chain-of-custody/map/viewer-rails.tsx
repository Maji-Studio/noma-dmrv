"use client";

/**
 * Carbon Viewer overlays — legend, transport-legs rail, not-geolocated rail,
 * split-view chip box, warning banner, empty state. Plain React absolutely
 * positioned over the map; all interactions route through onSelectNode so
 * the page can drive both map and DAG highlights.
 */

import {
  ArrowUpRight,
  CaretDown,
  CaretRight,
  Factory,
  Truck,
  X,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type {
  ChainGeoLeg,
  ChainGeoNode,
} from "@/data-access/chain-of-custody-geo";
import { formatDistanceKm, formatMass } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import {
  NODE_ACCENT_VAR,
  RAIL_AREA_CARD_WIDTH_PX,
  RAIL_DROPDOWN_WIDTH_PX,
} from "./viewer-constants";
import { totalLegDistanceKm } from "./viewer-utils";

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
// Transport bar (map view) — three areas read left→right as the carbon path:
//   Feedstock (consolidated) →[leg]→ Facility hub →[leg]→ Application
// Each area card opens a dropdown of its individual records (material + mass +
// a detail-page link); picking one focuses that sub-chain across bar/map/DAG.
// The transport-leg pills between the cards carry the distance — never the
// cards, which read material + mass (the carbon numbers).
// ---------------------------------------------------------------------------

type RailSide = "inbound" | "outbound";

const SIDE_ACCENT: Record<RailSide, string> = {
  inbound: "var(--acc-prod)",
  outbound: "var(--acc-dist)",
};

/** The outer party of a leg: supplier (inbound) or application field (outbound). */
function legOuterName(leg: ChainGeoLeg): string {
  const name = leg.kind === "inbound" ? leg.originName : leg.destinationName;
  return name ?? leg.outerCode ?? "Unknown";
}

/** Sum of cargo mass across legs (the area card's mass line), kg. */
function totalLoadMassKg(legs: ChainGeoLeg[]): number | null {
  const withMass = legs.filter((leg) => leg.loadMassKg != null);
  if (withMass.length === 0) return null;
  return withMass.reduce((sum, leg) => sum + (leg.loadMassKg ?? 0), 0);
}

/**
 * Collapsed material summary for the feedstock side: the single type when the
 * legs agree, else the first plus a "+N" remainder.
 */
function materialSummary(legs: ChainGeoLeg[]): string {
  const labels = Array.from(
    new Set(
      legs
        .map((leg) => leg.materialLabel)
        .filter((label): label is string => Boolean(label))
    )
  );
  if (labels.length === 0) return "—";
  if (labels.length === 1) return labels[0];
  return `${labels[0]} +${labels.length - 1}`;
}

interface AreaDropdownRowProps {
  leg: ChainGeoLeg;
  /** Filled dot when this leg is in focus (or nothing is focused = all on). */
  active: boolean;
  accent: string;
  onFocus: (leg: ChainGeoLeg) => void;
  onHoverLeg: (legId: string | null) => void;
}

/**
 * One record inside an area dropdown. The row body focuses the leg's sub-chain;
 * the trailing ↗ jumps to the record (stops propagation so it never focuses).
 * Hovering the row isolates that leg's line on the map.
 */
function AreaDropdownRow({
  leg,
  active,
  accent,
  onFocus,
  onHoverLeg,
}: AreaDropdownRowProps) {
  const meta = [leg.materialLabel, formatMass(leg.loadMassKg)]
    .filter(Boolean)
    .join(" · ");

  return (
    <DropdownMenu.Item onClick={() => onFocus(leg)} className="!px-12 !py-[9px]">
      <span
        className="flex w-full items-center gap-10"
        onMouseEnter={() => onHoverLeg(leg.id)}
        onMouseLeave={() => onHoverLeg(null)}
      >
        <span
          className="size-[7px] shrink-0 border-[1.5px]"
          style={{ background: active ? accent : "transparent", borderColor: accent }}
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.02em] text-[var(--clr-dark-purple)]">
            {legOuterName(leg)}
          </span>
          <span className="truncate font-mono text-[9px] uppercase tracking-[0.05em] text-[var(--clr-dark-purple-60)]">
            {meta || "—"}
          </span>
        </span>
        {leg.outerHref ? (
          <Link
            href={leg.outerHref}
            aria-label={`Open ${leg.outerCode ?? "record"}`}
            onClick={(event) => event.stopPropagation()}
            className="shrink-0 p-[3px] text-[var(--clr-dark-purple-40)] transition-colors hover:text-[var(--clr-dark-purple)]"
          >
            <ArrowUpRight size={13} weight="bold" aria-hidden="true" />
          </Link>
        ) : null}
      </span>
    </DropdownMenu.Item>
  );
}

interface AreaCardProps {
  side: RailSide;
  legs: ChainGeoLeg[];
  facilityName: string;
  focusLegIds: Set<string> | null;
  onFocusLeg: (leg: ChainGeoLeg) => void;
  onClearFocus: () => void;
  onHoverLeg: (legId: string | null) => void;
}

/**
 * One consolidated end of the bar (feedstock or application). The collapsed
 * card shows the area summary (material/site + total mass); the dropdown lists
 * each record. When a focus narrows this side, the summary reflects the subset.
 */
function AreaCard({
  side,
  legs,
  facilityName,
  focusLegIds,
  onFocusLeg,
  onClearFocus,
  onHoverLeg,
}: AreaCardProps) {
  const accent = SIDE_ACCENT[side];
  const eyebrow = side === "inbound" ? "Feedstock" : "Application";
  const shown = focusLegIds
    ? legs.filter((leg) => focusLegIds.has(leg.id))
    : legs;
  const summary =
    side === "inbound"
      ? materialSummary(shown)
      : `${shown.length} ${shown.length === 1 ? "site" : "sites"}`;
  const mass = totalLoadMassKg(shown);
  const narrowed = focusLegIds !== null && shown.length < legs.length;

  if (legs.length === 0) {
    return (
      <div
        className="flex shrink-0 flex-col justify-center gap-[5px] py-[13px] pl-[14px] pr-12"
        style={{ width: RAIL_AREA_CARD_WIDTH_PX, borderLeft: `2px solid ${accent}` }}
      >
        <span className="flex items-center gap-[6px] font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-[var(--clr-dark-purple-40)]">
          <span className="size-[6px] shrink-0" style={{ background: accent }} aria-hidden="true" />
          {eyebrow}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--clr-dark-purple-30)]">
          None recorded
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        render={
          <button
            type="button"
            data-testid="carbon-viewer-area-card"
            className="group flex shrink-0 cursor-pointer flex-col justify-center gap-[6px] py-[13px] pl-[14px] pr-12 text-left transition-colors hover:bg-[var(--clr-dark-purple-1)]"
            style={{
              width: RAIL_AREA_CARD_WIDTH_PX,
              borderLeft: `${narrowed ? 3 : 2}px solid ${accent}`,
            }}
          />
        }
      >
        <span className="flex items-center justify-between gap-8">
          <span className="flex items-center gap-[6px] font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-[var(--clr-dark-purple-40)]">
            <span className="size-[6px] shrink-0" style={{ background: accent }} aria-hidden="true" />
            {eyebrow}
          </span>
          <span className="flex items-center gap-[5px]">
            <span className="font-mono text-[10px] font-medium text-[var(--clr-dark-purple-60)]">
              {narrowed ? `${shown.length}/${legs.length}` : legs.length}
            </span>
            <CaretDown
              size={11}
              weight="bold"
              className="text-[var(--clr-dark-purple-30)] transition-transform duration-150 group-data-[popup-open]:rotate-180"
              aria-hidden="true"
            />
          </span>
        </span>
        <span className="truncate font-mono text-[12px] font-medium uppercase tracking-[0.02em] text-[var(--clr-dark-purple)]">
          {summary}
        </span>
        <span className="font-mono text-[10px] tracking-[0.02em] text-[var(--clr-dark-purple-60)]">
          {mass != null ? formatMass(mass) : "—"}
        </span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content
        side="top"
        align={side === "inbound" ? "start" : "end"}
        className="py-0"
      >
        <div style={{ width: RAIL_DROPDOWN_WIDTH_PX }}>
          <div className="border-b border-[var(--clr-dark-purple-10)] px-12 py-[9px] font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-[var(--clr-dark-purple-40)]">
            {side === "inbound"
              ? `Feedstock → ${facilityName}`
              : `${facilityName} → application`}
          </div>
          <div className="max-h-[220px] overflow-y-auto py-4">
            {legs.map((leg) => (
              <AreaDropdownRow
                key={leg.id}
                leg={leg}
                active={focusLegIds === null || focusLegIds.has(leg.id)}
                accent={accent}
                onFocus={onFocusLeg}
                onHoverLeg={onHoverLeg}
              />
            ))}
          </div>
          {focusLegIds !== null ? (
            <>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onClick={onClearFocus} className="!px-12 !py-8">
                <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]">
                  Show all
                </span>
              </DropdownMenu.Item>
            </>
          ) : null}
        </div>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

interface TransportLegPillProps {
  side: RailSide;
  legs: ChainGeoLeg[];
  focusLegIds: Set<string> | null;
}

/**
 * The hop between an area and the hub — a truck + distance over a directional
 * hairline. Shows the focused leg's distance when the focus narrows this side,
 * else the side total (per the all-selected default).
 */
function TransportLegPill({ side, legs, focusLegIds }: TransportLegPillProps) {
  const accent = SIDE_ACCENT[side];
  const relevant = focusLegIds
    ? legs.filter((leg) => focusLegIds.has(leg.id))
    : legs;
  const hasDistance = relevant.length > 0;
  const label = hasDistance
    ? formatDistanceKm(totalLegDistanceKm(relevant))
    : "—";

  return (
    <Tooltip content={`${label} transported`}>
      <div className="flex shrink-0 flex-col items-center justify-center gap-[5px] px-10">
        <span className="flex items-center gap-[5px] whitespace-nowrap font-mono text-[10px] font-medium tracking-[0.02em] text-[var(--clr-dark-purple)]">
          <Truck size={12} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
          {label}
        </span>
        <span className="flex items-center gap-[2px]" style={{ color: accent }} aria-hidden="true">
          <span className="h-px w-12" style={{ background: accent }} />
          <CaretRight size={11} weight="bold" />
        </span>
      </div>
    </Tooltip>
  );
}

interface FacilityHubProps {
  facility: { code: string; name: string };
  inCount: number;
  outCount: number;
  focusActive: boolean;
  onClearFocus: () => void;
}

/**
 * Center pivot. Largely non-interactive — its one action is clearing the focus
 * (reset to all-shown), enabled only while a focus is active. Distance lives on
 * the leg pills now, so the hub keeps just identity + the in/out counts.
 */
function FacilityHub({
  facility,
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
  /** Clear the active focus (hub click / "Show all"). */
  onClearFocus: () => void;
  /** Isolate a leg's line on the map while a dropdown row is hovered. */
  onHoverLeg: (legId: string | null) => void;
}

/**
 * The directional transport bar: feedstock area → leg → facility hub → leg →
 * application area, one continuous element pinned along the bottom of the map.
 */
export function TransportLegsRail({
  legs,
  facility,
  focusLegIds,
  onFocusLeg,
  onClearFocus,
  onHoverLeg,
}: TransportLegsRailProps) {
  if (legs.length === 0) return null;
  const inbound = legs.filter((leg) => leg.kind === "inbound");
  const outbound = legs.filter((leg) => leg.kind === "outbound");

  return (
    <div
      className={`flex items-stretch overflow-hidden ${RAIL_BOX_CLASS}`}
      data-testid="carbon-viewer-legs-rail"
    >
      <AreaCard
        side="inbound"
        legs={inbound}
        facilityName={facility.name}
        focusLegIds={focusLegIds}
        onFocusLeg={onFocusLeg}
        onClearFocus={onClearFocus}
        onHoverLeg={onHoverLeg}
      />
      <TransportLegPill side="inbound" legs={inbound} focusLegIds={focusLegIds} />
      <FacilityHub
        facility={facility}
        inCount={inbound.length}
        outCount={outbound.length}
        focusActive={focusLegIds !== null}
        onClearFocus={onClearFocus}
      />
      <TransportLegPill side="outbound" legs={outbound} focusLegIds={focusLegIds} />
      <AreaCard
        side="outbound"
        legs={outbound}
        facilityName={facility.name}
        focusLegIds={focusLegIds}
        onFocusLeg={onFocusLeg}
        onClearFocus={onClearFocus}
        onHoverLeg={onHoverLeg}
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
