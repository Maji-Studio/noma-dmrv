"use client";

/**
 * Docked custody-record panel — the map view's answer to the global
 * ChainNodeSheet for stage-rail clicks. Not a floating card: it docks
 * full-height against the map pane's left edge, flush with the stages rail, so
 * a leg click reads as a second column of the rail rather than chrome landing
 * on the map. Rows are edge to edge on the rail's hairline grid, and the record
 * gets one visual moment — the courier From→To thread when it sits on a
 * transport leg, its own duotone glyph otherwise. Closing it releases the
 * shared focus (wired on the page). On a viewer too narrow to hold a third
 * column it stops docking and covers the whole viewer instead — see the
 * container query in carbon-viewer.css.
 *
 * Nothing animates: the rail's own rows appear instantly, so a column sliding
 * out from under them reads as a separate object arriving rather than as more of
 * the rail. Type balance follows the ChainNodeSheet: labels whisper in mono
 * micro caps, content speaks in the inherited sans. Mono is left only where the
 * value is code-like — the record code, coordinates, a measurement.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowUpRightIcon,
  CircleIcon,
  MapPinIcon,
  TreeStructureIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import type {
  ChainGeoLeg,
  ChainGeoNode,
  ChainGeoPositionSource,
} from "@/data-access/chain-of-custody-geo";
import { Button } from "@/components/ui/button";
import { formatDistanceKm, formatMass } from "@/lib/format-utils";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { getStatusState, getStatusStateColor } from "@/lib/status-state";
import { cn } from "@/lib/utils";
import type { ChainNodeSheetNode } from "../chain-node-sheet";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Docked width, applied by `.cv-record-panel` in carbon-viewer.css and fed
 * there by carbon-transit-panel.tsx. The stylesheet owns it because the same
 * rules clamp the panel to the map pane and, on a narrow viewer, drop the dock
 * entirely and lay the record over the whole viewer.
 */
export const RECORD_PANEL_WIDTH_PX = 320;
/** Accent rule across the panel's very top — the entity family's ink. */
const ACCENT_RULE_PX = 2;
/** Faint accent ground under the illustration band (percent of accent ink). */
const WASH_MIX_PCT = 8;

const HEADER_ICON_PX = 13;
const CLOSE_ICON_PX = 12;
const ACTION_ICON_PX = 12;
const STATUS_DOT_PX = 6;
/** Centred glyph column in the From→To thread; also the thread's own width. */
const STOP_COL_PX = 20;
const STOP_ICON_PX = 13;
/** The entity's own duotone portrait, when it carries no transport leg. */
const HERO_ICON_PX = 40;
/** GPS pairs are shown at ~1 m resolution, the precision operators enter. */
const COORD_DECIMALS = 5;
/** The viewer's one term for a value nobody has entered yet. */
const MISSING_NAME = "Not recorded";

const MICRO_CAPS =
  "font-mono text-[9.5px] font-medium uppercase tracking-[0.1em]";
const HAIRLINE = "border-b border-[var(--clr-dark-purple-10)]";
const INK_STRONG = "text-[var(--clr-dark-purple)]";
const INK_MUTED = "text-[var(--clr-dark-purple-60)]";
const INK_FAINT = "text-[var(--clr-dark-purple-40)]";
/** Field values: the inherited sans, sentence case. `MONO_VALUE` overrides it
 *  on the code-like ones, a step smaller so the panel stays quiet. */
const VALUE_CLASS = "min-w-0 truncate text-right text-[12.5px]";
const MONO_VALUE = "font-mono text-[11px] font-medium tracking-[0.02em]";
const ACTION_CLASS =
  "flex flex-1 cursor-pointer items-center justify-center gap-6 px-8 py-12 " +
  "font-mono text-[10px] font-medium uppercase tracking-[0.08em] " +
  "transition-colors hover:bg-[var(--clr-dark-purple-1)]";

/** Plain-words provenance for a leg's distance, mirroring DISTANCE_SOURCE_LABELS. */
const DISTANCE_PROVENANCE: Record<DistanceSourceValue, string> = {
  map_estimate: "route estimate",
  manual: "manual entry",
  document: "transport document",
};

/** How the map came to plot this record, in the rail's own vocabulary. */
const POSITION_SOURCE_LABELS: Record<ChainGeoPositionSource, string> = {
  own: "Own GPS",
  leg_origin: "From the supplier's position",
  facility: "Shown at the facility",
  none: "Not plotted",
};

// ---------------------------------------------------------------------------
// Derived copy helpers
// ---------------------------------------------------------------------------

/** "42 km · route estimate" — the number, then how it was arrived at. */
function distanceLine(leg: ChainGeoLeg): string {
  const distance = formatDistanceKm(leg.distanceKm);
  const provenance = leg.distanceSource
    ? DISTANCE_PROVENANCE[leg.distanceSource]
    : leg.isDerived
      ? "derived from the delivery"
      : null;
  return provenance ? `${distance} · ${provenance}` : distance;
}

/** The mass the leg's own side records: cargo in, applied wet out. */
function legMassRow(leg: ChainGeoLeg): { label: string; value: string } | null {
  const inbound = leg.kind === "inbound";
  const mass = inbound ? leg.loadMassKg : leg.appliedWetMassKg;
  if (mass == null) return null;
  return { label: inbound ? "Load mass" : "Applied mass", value: formatMass(mass) };
}

function coordinateLine(geoNode: ChainGeoNode): string | null {
  if (geoNode.lat == null || geoNode.lng == null) return null;
  return `${geoNode.lat.toFixed(COORD_DECIMALS)}, ${geoNode.lng.toFixed(COORD_DECIMALS)}`;
}

// ---------------------------------------------------------------------------
// Panel pieces
// ---------------------------------------------------------------------------

/** The sheet's status pill, compacted for the panel header. */
function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-4 whitespace-nowrap border-[1.5px] border-current px-4 py-2 font-mono text-[8px] font-medium uppercase tracking-[0.09em]"
      data-status-state={getStatusState(status)}
      style={{ color: getStatusStateColor(status) }}
    >
      <span aria-hidden className="bg-current" style={{ width: STATUS_DOT_PX, height: STATUS_DOT_PX }} />
      {status.replaceAll("_", " ")}
    </span>
  );
}

/** Micro-caps section label, on the same full-bleed grid as the rows under it. */
function SectionLabel({ children }: { children: string }) {
  return (
    <div className={cn(MICRO_CAPS, HAIRLINE, "px-16 py-8 font-normal", INK_FAINT)}>{children}</div>
  );
}

/** `mono` is for bare data tokens: coordinates, a measurement. A value carrying
 *  prose (a distance and how it was arrived at) stays in the body sans. */
function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-12 px-16 py-8", HAIRLINE)}>
      <span className={cn(MICRO_CAPS, "shrink-0 font-normal", INK_MUTED)}>{label}</span>
      <span className={cn(VALUE_CLASS, mono && MONO_VALUE, INK_STRONG)}>{value}</span>
    </div>
  );
}

/**
 * One end of the courier thread: micro-caps role over the party's name. `ink`
 * is set on the record's own end of the leg and null on the counterparty.
 */
function ThreadStop({
  icon: StopIcon,
  label,
  value,
  ink,
}: {
  icon: ChainNodeSheetNode["icon"];
  label: string;
  value: string;
  ink: string | null;
}) {
  return (
    <div className="flex items-center gap-10">
      <span className="flex shrink-0 justify-center" style={{ width: STOP_COL_PX }} aria-hidden="true">
        <StopIcon size={STOP_ICON_PX} weight={ink ? "fill" : "regular"} style={{ color: ink ?? "var(--clr-dark-purple-40)" }} />
      </span>
      <span className="flex min-w-0 flex-col gap-2">
        <span className={cn(MICRO_CAPS, "font-normal", INK_FAINT)}>{label}</span>
        <span className="truncate text-[12.5px] font-medium" style={{ color: ink ?? "var(--clr-dark-purple)" }}>
          {value}
        </span>
      </span>
    </div>
  );
}

interface IllustrationProps {
  node: ChainNodeSheetNode;
  leg: ChainGeoLeg | null;
  facilityName: string | null;
}
/**
 * The panel's single visual moment, on a faint wash of the entity's own accent.
 * A leg-anchored record gets the courier From→To thread with its own end lit;
 * everything else gets a large duotone portrait of its family glyph. No radius
 * anywhere — the only circles in the system are Phosphor glyphs.
 */
function IllustrationBand({ node, leg, facilityName }: IllustrationProps) {
  const { icon: Icon, accentInk } = node;
  const wash = `color-mix(in srgb, ${accentInk} ${WASH_MIX_PCT}%, var(--paper))`;

  if (!leg) {
    return (
      <div className={cn("flex items-center justify-center py-24", HAIRLINE)} style={{ background: wash }}>
        <Icon size={HERO_ICON_PX} weight="duotone" style={{ color: accentInk }} aria-hidden="true" />
      </div>
    );
  }

  const inbound = leg.kind === "inbound";
  const facilityLabel = facilityName ?? "Facility";
  const origin = inbound
    ? (leg.originName ?? leg.outerCode ?? MISSING_NAME)
    : facilityLabel;
  const destination = inbound
    ? facilityLabel
    : (leg.destinationName ?? leg.outerCode ?? MISSING_NAME);

  return (
    <div className={cn("px-16 py-16", HAIRLINE)} style={{ background: wash }}>
      <ThreadStop icon={CircleIcon} label="From" value={origin} ink={inbound ? accentInk : null} />
      <div className="flex py-2" aria-hidden="true">
        <span className="flex shrink-0 justify-center" style={{ width: STOP_COL_PX }}>
          <span className="h-20 w-0 border-l-[1.5px] border-dashed border-[var(--clr-dark-purple-30)]" />
        </span>
      </div>
      <ThreadStop icon={MapPinIcon} label="To" value={destination} ink={inbound ? null : accentInk} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface RecordDetailPanelProps {
  node: ChainNodeSheetNode;
  onClose: () => void;
  /** Batch roll-up application card — drills into the member's rollback. */
  onTrace?: (nodeId: string) => void;
  /** The transport leg this record anchors, when it has one. */
  leg?: ChainGeoLeg | null;
  /** The record's position-resolved geo node, when the map knows one. */
  geoNode?: ChainGeoNode | null;
  /** The transport counterparty on the facility side of every leg. */
  facilityName?: string | null;
}

export function RecordDetailPanel({
  node,
  onClose,
  onTrace,
  leg = null,
  geoNode = null,
  facilityName = null,
}: RecordDetailPanelProps) {
  const { id, label, code, icon: Icon, accentInk, status, date, details, href, drillable } = node;
  const massRow = leg ? legMassRow(leg) : null;
  const coordinates = geoNode ? coordinateLine(geoNode) : null;

  return (
    <aside
      aria-label={`${label} ${code} details`}
      data-testid="carbon-viewer-detail-panel"
      className="cv-record-panel absolute inset-y-0 z-20 flex flex-col overflow-hidden border-r-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)]"
      style={{ borderTop: `${ACCENT_RULE_PX}px solid ${accentInk}` }}
    >
      <header className={cn("px-16 pb-12 pt-12", HAIRLINE)}>
        <div className="flex items-center justify-between gap-8">
          <span className={cn(MICRO_CAPS, "flex min-w-0 items-center gap-6")} style={{ color: accentInk }}>
            <Icon size={HEADER_ICON_PX} weight="bold" className="shrink-0" />
            <span className="truncate">{label}</span>
          </span>
          <span className="flex shrink-0 items-center gap-8">
            <StatusPill status={status} />
            {/* The panel's only dismissal, so it gets a real hit target rather
                than the bare glyph. `-mr-8` keeps the icon optically on the
                header's padding edge while the button extends past it. */}
            <Button
              size="icon"
              variant="noOutline"
              onClick={onClose}
              aria-label="Close details"
              data-testid="carbon-viewer-detail-panel-close"
              className="-mr-8 text-[var(--clr-dark-purple-40)] hover:text-[var(--clr-dark-purple)]"
            >
              <XIcon size={CLOSE_ICON_PX} weight="bold" aria-hidden />
            </Button>
          </span>
        </div>
        <div className={cn("mt-8 font-mono text-[15px] font-medium tracking-[0.02em]", INK_STRONG)}>
          {code}
        </div>
        {date ? (
          <div className={cn("mt-4 text-[12.5px]", INK_MUTED)}>{date}</div>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <IllustrationBand node={node} leg={leg} facilityName={facilityName} />

        {leg ? (
          <section>
            <SectionLabel>Transport</SectionLabel>
            {leg.materialLabel ? (
              <InfoRow label="Material" value={leg.materialLabel} />
            ) : null}
            <InfoRow label="Distance" value={distanceLine(leg)} />
            {massRow ? <InfoRow label={massRow.label} value={massRow.value} mono /> : null}
          </section>
        ) : null}

        {geoNode ? (
          <section>
            <SectionLabel>Position</SectionLabel>
            <InfoRow label="Plotted" value={POSITION_SOURCE_LABELS[geoNode.positionSource]} />
            {coordinates ? <InfoRow label="Coordinates" value={coordinates} mono /> : null}
          </section>
        ) : null}

        <section>
          <SectionLabel>Details</SectionLabel>
          {details.length > 0 ? (
            details.map((row) => (
              <InfoRow key={`${row.label}:${row.value}`} label={row.label} value={row.value} />
            ))
          ) : (
            <div className={cn("px-16 py-10 text-[12.5px]", INK_FAINT)}>
              No additional detail recorded
            </div>
          )}
        </section>
      </div>

      {(drillable && onTrace) || href ? (
        <footer className="mt-auto flex items-stretch border-t-[1.5px] border-[var(--clr-dark-purple-20)]">
          {drillable && onTrace ? (
            <button
              type="button"
              onClick={() => onTrace(id)}
              className={cn(
                ACTION_CLASS,
                "border-r border-[var(--clr-dark-purple-10)] text-[var(--color-interaction)] last:border-r-0"
              )}
            >
              <TreeStructureIcon size={ACTION_ICON_PX} weight="bold" aria-hidden />
              Trace rollback
            </button>
          ) : null}
          {href ? (
            <Link
              href={href}
              className={cn(ACTION_CLASS, INK_MUTED, "hover:text-[var(--clr-dark-purple)]")}
            >
              <ArrowUpRightIcon size={ACTION_ICON_PX} weight="bold" aria-hidden />
              View full record
            </Link>
          ) : null}
        </footer>
      ) : null}
    </aside>
  );
}
