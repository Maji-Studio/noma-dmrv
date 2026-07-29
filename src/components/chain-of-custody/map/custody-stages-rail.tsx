"use client";

/**
 * Custody stages rail — the map view's persistent left column.
 *
 * A courier-style status timeline: three milestones (feedstock in → pyrolysis →
 * application out) on a dashed thread, each either COMPLETE (every leg has a
 * mass and a plottable position) or still open with the gap named in plain
 * words. Legs demote to sub-rows that open their record in the docked detail
 * panel; they carry no dates, so the courier's timestamp slot holds carbon
 * numbers instead. Everything is a full-bleed row on the rail's hairline grid,
 * with the thread running in a gutter inside those rows.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowUpRightIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  LeafIcon,
  MapPinIcon,
  TruckIcon,
} from "@phosphor-icons/react/dist/ssr";
import type {
  ChainGeoLeg,
  ChainGeoNode,
  ChainOfCustodyGeoData,
} from "@/data-access/chain-of-custody-geo";
import { formatDistanceKm, formatMass } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  legAnchorNodeId,
  resolveLegEndpoints,
  totalLegAppliedWetMassKg,
  totalLegDistanceKm,
  totalLegLoadMassKg,
} from "./viewer-utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The rail's own width — the map pane takes whatever is left, and the docked
 * record panel starts on the same line. Applied by `.cv-rail` in
 * carbon-viewer.css (an inline width would outrank the narrow-viewer rules
 * that stack the rail above the map), fed there by carbon-transit-panel.tsx.
 */
export const RAIL_WIDTH_PX = 340;

/** Left gutter the thread and the milestone glyphs live in, inside each row. */
const GUTTER_PX = 40;
/** Thread x-offset: gutter centre, less half the 1.5px stroke. */
const THREAD_INSET_PX = 19;
/** Milestone glyph (px) — the three status nodes on the thread. */
const MILESTONE_ICON_PX = 20;
/** Breathing room around a glyph; also the gap the thread leaves for it. */
const GLYPH_PAD_PX = 4;
/** Vertical padding of a milestone band (the `py-12` below). */
const BAND_PAD_PX = 12;
/** A glyph's centre inside its band, and the half-gap the thread breaks for. */
const GLYPH_CENTER_PX = BAND_PAD_PX + GLYPH_PAD_PX + MILESTONE_ICON_PX / 2;
const THREAD_GAP_HALF_PX = MILESTONE_ICON_PX / 2 + GLYPH_PAD_PX;

/** Box the sub-row's leading status glyph centres in, whatever shape it takes. */
const SUB_GLYPH_BOX_PX = 12;
/** Filled square marking a fully recorded leg — mirrors the map's markers (px). */
const SUB_DOT_PX = 7;
const SUB_DASHED_ICON_PX = 11;
const KIND_ICON_PX = 12;
const TRUCK_ICON_PX = 12;
const LINK_ICON_PX = 13;
const CARET_ICON_PX = 11;

/** Above this many legs a side collapses behind its band's disclosure caret. */
const ACCORDION_MAX_VISIBLE_LEGS = 4;
/** The band rule the thread has to reach across to stay unbroken (px). */
const BAND_RULE_PX = 1.5;

const ACCENT_ORIGIN = "var(--acc-prod)";
const ACCENT_ORIGIN_INK = "var(--acc-prod-ink)";
const ACCENT_FACILITY_INK = "var(--acc-infra-ink)";
const ACCENT_SITE = "var(--acc-dist)";
const ACCENT_SITE_INK = "var(--acc-dist-ink)";
const ACCENT_PENDING = "var(--clr-dark-purple-30)";

/** The viewer's one term for a value nobody has entered yet. */
const MISSING_NAME = "Not recorded";

/** The viewer's micro caps idiom (section labels, eyebrows, meta lines). */
const MICRO_CAPS =
  "font-mono text-[9.5px] font-medium uppercase tracking-[0.1em]";
/** The milestone title idiom — one step up from a rail section label. */
const MILESTONE_TITLE =
  "font-mono text-[12.5px] font-medium uppercase tracking-[0.04em]";

const ROW_HOVER_TINT = "bg-[var(--clr-dark-purple-1)]";
const HAIRLINE = "border-b border-[var(--clr-dark-purple-10)]";
const BAND_RULE = "border-b-[1.5px] border-[var(--clr-dark-purple-20)]";
const INK_STRONG = "text-[var(--clr-dark-purple)]";
const INK_MUTED = "text-[var(--clr-dark-purple-60)]";
const INK_FAINT = "text-[var(--clr-dark-purple-40)]";

/** Every row is full bleed: the gutter is padding inside it, never a margin. */
const SUB_ROW_CLASS =
  "flex w-full min-w-0 flex-1 cursor-pointer items-center gap-8 py-10 pr-16 " +
  "text-left transition-colors hover:bg-[var(--clr-dark-purple-1)]";
const SUB_NAME_CLASS =
  "min-w-0 flex-1 truncate font-mono text-[11px] font-medium uppercase tracking-[0.02em]";
const METRIC_CLASS =
  "flex shrink-0 items-center gap-6 whitespace-nowrap font-mono text-[10px] font-medium tracking-[0.02em]";

// ---------------------------------------------------------------------------
// Derived copy helpers
// ---------------------------------------------------------------------------

/** The outer party of a leg: supplier (inbound) or application field (outbound). */
function legOuterName(leg: ChainGeoLeg): string {
  const name = leg.kind === "inbound" ? leg.originName : leg.destinationName;
  return name ?? leg.outerCode ?? MISSING_NAME;
}

/**
 * What a leg is still missing. Both gaps are the same idea from the map's point
 * of view: the row exists but the number or the position behind it does not.
 * The mass is the one the leg's own side records — cargo in, applied wet out.
 */
interface LegGaps {
  noMass: boolean;
  noPosition: boolean;
}

function legGaps(leg: ChainGeoLeg, plottableLegIds: Set<string>): LegGaps {
  const mass = leg.kind === "inbound" ? leg.loadMassKg : leg.appliedWetMassKg;
  return { noMass: mass == null, noPosition: !plottableLegIds.has(leg.id) };
}

/** Micro suffix on an incomplete sub-row, naming the gap. */
function legGapSuffix(gaps: LegGaps): string | null {
  const parts = [
    ...(gaps.noPosition ? ["no GPS"] : []),
    ...(gaps.noMass ? ["no mass"] : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// Milestone state — the courier "delivered vs pending" translated to data
// ---------------------------------------------------------------------------

interface MilestoneState {
  complete: boolean;
  meta: string;
}

/**
 * A transport side is complete when it carries at least one leg and every one
 * of those legs has both a recorded mass and two plottable endpoints. Complete
 * reads as the carbon numbers; incomplete names the gap instead. Distance is
 * not in here — it rides the band's right edge as its own metric.
 */
function transportMilestone(
  legs: ChainGeoLeg[],
  plottableLegIds: Set<string>,
  side: "inbound" | "outbound"
): MilestoneState {
  const inbound = side === "inbound";
  const units = inbound ? "origins" : "sites";

  if (legs.length === 0) return { complete: false, meta: "None recorded" };

  const gaps = legs.map((leg) => legGaps(leg, plottableLegIds));
  const missingPosition = gaps.filter((gap) => gap.noPosition).length;
  const missingMass = gaps.filter((gap) => gap.noMass).length;

  if (missingPosition > 0 || missingMass > 0) {
    const gapParts = [
      ...(missingPosition > 0
        ? [`${missingPosition} of ${legs.length} ${units} missing GPS`]
        : []),
      ...(missingMass > 0
        ? [`${missingMass} ${missingMass === 1 ? "leg" : "legs"} missing mass`]
        : []),
    ];
    return { complete: false, meta: gapParts.join(" · ") };
  }

  const mass = inbound ? totalLegLoadMassKg(legs) : totalLegAppliedWetMassKg(legs);
  const meta = [
    `${legs.length} ${legs.length === 1 ? units.slice(0, -1) : units}`,
    ...(mass == null
      ? []
      : [`${formatMass(mass)} ${inbound ? "received" : "applied"}`]),
  ].join(" · ");

  return { complete: true, meta };
}

/** The facility is the one milestone with nothing hanging under it. */
function facilityMilestone(
  facility: ChainOfCustodyGeoData["facility"]
): MilestoneState {
  if (facility.lat == null || facility.lng == null) {
    return { complete: false, meta: "No GPS position on the facility" };
  }
  const name = facility.name?.trim();
  return { complete: true, meta: name ? `${facility.code} · ${name}` : facility.code };
}

// ---------------------------------------------------------------------------
// Timeline pieces
// ---------------------------------------------------------------------------

/** Where a band sits on the thread: the first node opens it, the last closes it. */
type ThreadSegment = "start" | "middle" | "end";

/**
 * The thread above a glyph, and below it past this milestone's sub-rows. The
 * lower piece overshoots the section's own rule — an absolute box lays out
 * against the padding box, so `bottom: 0` stops a hairline short and reads as a
 * gap. The only breaks in the line are the glyph windows.
 */
const THREAD_ABOVE = {
  left: THREAD_INSET_PX,
  top: 0,
  height: GLYPH_CENTER_PX - THREAD_GAP_HALF_PX,
};
const THREAD_BELOW = {
  left: THREAD_INSET_PX,
  top: GLYPH_CENTER_PX + THREAD_GAP_HALF_PX,
  bottom: -BAND_RULE_PX,
};
const THREAD_CLASS =
  "pointer-events-none absolute z-[1] w-0 border-l-[1.5px] border-dashed " +
  "border-[var(--clr-dark-purple-30)]";

/** A side's transported distance, at the band's right padding edge. */
function DistanceMetric({ legs, ink }: { legs: ChainGeoLeg[]; ink: string }) {
  if (legs.length === 0) return null;
  return (
    <span className={METRIC_CLASS} style={{ color: ink }}>
      <TruckIcon size={TRUCK_ICON_PX} className="shrink-0" aria-hidden="true" />
      {formatDistanceKm(totalLegDistanceKm(legs))}
    </span>
  );
}

interface MilestoneBandProps {
  segment: ThreadSegment;
  state: MilestoneState;
  title: string;
  /** Glyph colour when complete; pending is always plum. */
  accent: string;
  /**
   * Glyph for the complete state. Defaults to the courier's check — override it
   * where "complete" is not a claim about the step itself: the facility band is
   * only saying the hub is plotted, and a check there would read as "pyrolysis
   * verified", which no map data can attest.
   */
  completeIcon?: typeof CheckCircleIcon;
  /** Right-edge slot: the side's distance, or the facility's in/out counts. */
  metric?: ReactNode;
  /** Sub-rows follow: the band closes with a hairline, not the section rule. */
  divided?: boolean;
  /** Disclosure state. Undefined = inert band: no caret, no button, no toggle. */
  expanded?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}

/**
 * One node on the status timeline, as a full-bleed band: glyph in the gutter,
 * title + meta beside it, metric at the right padding edge, sub-rows below. The
 * thread is drawn in two pieces so it breaks around the glyph without a backing
 * patch, and paints above the rows so a hover tint never cuts it. A long side
 * turns the band into the disclosure toggle for its own sub-rows.
 */
function MilestoneBand({
  segment,
  state,
  title,
  accent,
  completeIcon: CompleteIcon = CheckCircleIcon,
  metric,
  divided,
  expanded,
  onToggle,
  children,
}: MilestoneBandProps) {
  const body = (
    <>
      <span className="flex shrink-0 justify-center" style={{ width: GUTTER_PX }} aria-hidden="true">
        <span className="py-4">
          {state.complete ? (
            <CompleteIcon size={MILESTONE_ICON_PX} weight="fill" style={{ color: accent }} />
          ) : (
            <CircleIcon size={MILESTONE_ICON_PX} style={{ color: ACCENT_PENDING }} />
          )}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-4 pr-10">
        <span className={cn(MILESTONE_TITLE, state.complete ? INK_STRONG : INK_MUTED)}>
          {title}
        </span>
        <span className={cn(MICRO_CAPS, "truncate font-normal tracking-[0.07em]", state.complete ? INK_MUTED : INK_FAINT)}>
          {state.meta}
        </span>
      </span>
      {metric}
      {onToggle ? (
        <CaretDownIcon
          size={CARET_ICON_PX}
          weight="bold"
          aria-hidden="true"
          className={cn("ml-10 shrink-0 transition-transform", INK_FAINT, !expanded && "-rotate-90")}
        />
      ) : null}
    </>
  );

  const bandClass = cn("flex w-full items-center py-12 pr-16 text-left", divided && HAIRLINE);

  return (
    <section className={cn("relative", BAND_RULE)}>
      {segment === "start" ? null : <div aria-hidden className={THREAD_CLASS} style={THREAD_ABOVE} />}
      {segment === "end" ? null : <div aria-hidden className={THREAD_CLASS} style={THREAD_BELOW} />}
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className={cn(bandClass, "cursor-pointer transition-colors hover:bg-[var(--clr-dark-purple-1)]")}
        >
          {body}
        </button>
      ) : (
        <div className={bandClass}>{body}</div>
      )}
      {expanded === false ? null : children}
    </section>
  );
}

/**
 * Leading status glyph on a sub-row: a filled square in the side's accent when
 * the record is complete, a dashed ring when something is still missing.
 */
function SubGlyph({ accent }: { accent: string | null }) {
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: SUB_GLYPH_BOX_PX }} aria-hidden>
      {accent ? (
        <span style={{ width: SUB_DOT_PX, height: SUB_DOT_PX, background: accent }} />
      ) : (
        <CircleDashedIcon size={SUB_DASHED_ICON_PX} style={{ color: ACCENT_PENDING }} />
      )}
    </span>
  );
}

/** Trailing micro note on a sub-row: the gap it has, or why it is unplottable. */
function SubNote({ text, tone }: { text: string; tone: string }) {
  return (
    <span className={cn(MICRO_CAPS, "shrink-0 whitespace-nowrap font-normal tracking-[0.06em]", tone)}>
      {text}
    </span>
  );
}

/** `dimmed`: outside an active focus. `hovered`: the map's line hover, echoed. */
interface LegSubRowProps {
  leg: ChainGeoLeg;
  gaps: LegGaps;
  accent: string;
  accentInk: string;
  dimmed: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (legId: string | null) => void;
}

/**
 * One leg under its milestone: full-bleed, one line, quieter than the band. A
 * click focuses the leg's sub-chain, eases the camera to its marker and opens
 * its record; hover runs both ways with the map; the ↗ jumps to the detail
 * page. The kind icon (leaf in, pin out) is there to be scanned, not read.
 */
function LegSubRow({
  leg,
  gaps,
  accent,
  accentInk,
  dimmed,
  hovered,
  onSelect,
  onHover,
}: LegSubRowProps) {
  const recorded = !gaps.noMass && !gaps.noPosition;
  const suffix = legGapSuffix(gaps);
  const KindIcon = leg.kind === "inbound" ? LeafIcon : MapPinIcon;

  return (
    <div
      className={cn(
        "flex items-stretch transition-opacity",
        HAIRLINE,
        hovered && ROW_HOVER_TINT,
        dimmed && "opacity-40"
      )}
      onMouseEnter={() => onHover(leg.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button
        type="button"
        onClick={onSelect}
        className={SUB_ROW_CLASS}
        style={{ paddingLeft: GUTTER_PX }}
      >
        <SubGlyph accent={recorded ? accent : null} />
        <KindIcon size={KIND_ICON_PX} className={cn("shrink-0", INK_FAINT)} aria-hidden="true" />
        <span className={cn(SUB_NAME_CLASS, recorded ? INK_STRONG : INK_MUTED)}>
          {legOuterName(leg)}
        </span>
        {suffix ? <SubNote text={suffix} tone={INK_FAINT} /> : null}
        <span className={METRIC_CLASS} style={{ color: accentInk }}>
          {formatDistanceKm(leg.distanceKm)}
        </span>
      </button>
      {leg.outerHref ? (
        <Link
          href={leg.outerHref}
          aria-label={`Open ${leg.outerCode ?? "record"}`}
          className="flex shrink-0 items-center px-12 text-[var(--clr-dark-purple-30)] transition-colors hover:bg-[var(--clr-dark-purple-1)] hover:text-[var(--clr-dark-purple)]"
        >
          <ArrowUpRightIcon size={LINK_ICON_PX} weight="bold" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

/** `detail` is why the map cannot draw it — the row's right-hand note. */
interface NoPositionEntry {
  key: string;
  nodeId: string;
  /** Set on a leg row so the panel opens that leg, not a sibling on the same record. */
  legId?: string;
  code: string;
  detail: string;
}

/**
 * Everything the map cannot draw, kept visible rather than dropped: nodes that
 * inherit (or lack) a position, plus legs missing an endpoint. Clicking one
 * still focuses its sub-chain so the DAG and popups stay reachable.
 *
 * The two passes dedupe on different keys: a record is listed once, but every
 * unplottable leg gets its own row — several legs can share an anchor record,
 * and each is a separate missing endpoint the operator has to go fix.
 */
function buildNoPositionEntries(
  geo: ChainOfCustodyGeoData,
  unplottableLegs: ChainGeoLeg[]
): NoPositionEntry[] {
  const entries: NoPositionEntry[] = [];
  const seenNodes = new Set<string>();

  const ungeolocated: ChainGeoNode[] = geo.nodes.filter(
    (node) => node.positionSource === "facility" || node.positionSource === "none"
  );
  for (const node of ungeolocated) {
    if (seenNodes.has(node.id)) continue;
    seenNodes.add(node.id);
    const detail =
      node.positionSource === "facility" ? "Shown at the facility" : "Not plotted";
    entries.push({ key: node.id, nodeId: node.id, code: node.code, detail });
  }

  for (const leg of unplottableLegs) {
    entries.push({
      key: leg.id,
      nodeId: legAnchorNodeId(geo, leg),
      legId: leg.id,
      code: leg.outerCode ?? legOuterName(leg),
      detail: `${formatDistanceKm(leg.distanceKm)} leg, endpoint missing`,
    });
  }

  return entries;
}

/** Closes the rail as a quiet section on the same grid, never a fourth stage. */
function NotOnMapCluster({
  entries,
  focusNodeIds,
  onNodeSelect,
}: {
  entries: NoPositionEntry[];
  focusNodeIds: Set<string> | null;
  onNodeSelect: (nodeId: string, legId?: string | null) => void;
}) {
  return (
    <section className={BAND_RULE}>
      <header className={cn("flex items-center justify-between gap-8 px-16 py-10", HAIRLINE)}>
        <span className={cn(MICRO_CAPS, INK_FAINT)}>Not on the map</span>
        <span className={cn("font-mono text-[9.5px] font-medium tracking-[0.04em]", INK_MUTED)}>{entries.length}</span>
      </header>
      {entries.map((entry) => {
        const dimmed = focusNodeIds !== null && !focusNodeIds.has(entry.nodeId);
        return (
          <button
            key={entry.key}
            type="button"
            onClick={() => onNodeSelect(entry.nodeId, entry.legId)}
            className={cn(SUB_ROW_CLASS, HAIRLINE, dimmed && "opacity-40")}
            style={{ paddingLeft: GUTTER_PX }}
          >
            <SubGlyph accent={null} />
            <MapPinIcon size={KIND_ICON_PX} className="shrink-0 text-[var(--clr-dark-purple-30)]" aria-hidden />
            <span className={cn(SUB_NAME_CLASS, INK_MUTED)}>{entry.code}</span>
            <SubNote text={entry.detail} tone="text-[var(--clr-dark-purple-30)]" />
          </button>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

export interface CustodyStagesRailProps {
  geo: ChainOfCustodyGeoData;
  /** Reachable sub-chain node ids for the active focus; null = nothing focused. */
  focusNodeIds: Set<string> | null;
  /** Leg ids inside that focus; null = nothing focused (no sub-row dimming). */
  focusLegIds: Set<string> | null;
  /** The leg under the pointer, shared both ways with the map's line hover. */
  hoverLegId: string | null;
  onHoverLeg: (legId: string | null) => void;
  /**
   * Row click: focus the sub-chain and open the record's detail panel. The leg
   * id rides along on a leg row so the panel shows the clicked leg's numbers
   * rather than the first one anchored on the same record.
   */
  onSelectNode: (nodeId: string, legId?: string | null) => void;
}

/**
 * The rail itself. Owns only its disclosure state — the panel keys this
 * component on the plotted source, so a batch/application change remounts it
 * with both sides collapsed and the scroll back at the top.
 */
export function CustodyStagesRail({
  geo,
  focusNodeIds,
  focusLegIds,
  hoverLegId,
  onHoverLeg,
  onSelectNode,
}: CustodyStagesRailProps) {
  // Long sides start collapsed; short ones ignore this and stay open.
  const [openIn, setOpenIn] = useState(false);
  const [openOut, setOpenOut] = useState(false);

  const inbound = geo.legs.filter((leg) => leg.kind === "inbound");
  const outbound = geo.legs.filter((leg) => leg.kind === "outbound");
  const resolvedLegs = resolveLegEndpoints(geo);
  const plottableLegIds = new Set(
    resolvedLegs.plottable.map((entry) => entry.leg.id)
  );
  const noPosition = buildNoPositionEntries(geo, resolvedLegs.unplottable);

  const inboundStage = transportMilestone(inbound, plottableLegIds, "inbound");
  const facilityStage = facilityMilestone(geo.facility);
  const outboundStage = transportMilestone(outbound, plottableLegIds, "outbound");

  // Only a long side gets a caret; short ones render as plain, open bands.
  const inCollapsible = inbound.length > ACCORDION_MAX_VISIBLE_LEGS;
  const outCollapsible = outbound.length > ACCORDION_MAX_VISIBLE_LEGS;
  const inOpen = !inCollapsible || openIn;
  const outOpen = !outCollapsible || openOut;

  const renderSubRow = (leg: ChainGeoLeg, accent: string, accentInk: string) => (
    <LegSubRow
      key={leg.id}
      leg={leg}
      gaps={legGaps(leg, plottableLegIds)}
      accent={accent}
      accentInk={accentInk}
      dimmed={focusLegIds !== null && !focusLegIds.has(leg.id)}
      hovered={hoverLegId === leg.id}
      onSelect={() => onSelectNode(legAnchorNodeId(geo, leg), leg.id)}
      onHover={onHoverLeg}
    />
  );

  return (
    <aside
      className="cv-rail shrink-0 overflow-y-auto border-r-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)]"
      data-testid="carbon-viewer-stage-rail"
    >
      <header className="border-b-[1.5px] border-[var(--clr-dark-purple-20)] px-16 py-16">
        {/* div, not p: an unlayered `p, .body-medium` rule in globals.css
            overrides utility font classes on every bare paragraph. */}
        <div className="text-[16px] font-medium text-[var(--clr-dark-purple)]">
          Custody stages
        </div>
      </header>

      <MilestoneBand
        segment="start"
        state={inboundStage}
        title="Feedstock in"
        accent={ACCENT_ORIGIN_INK}
        divided={inbound.length > 0 && inOpen}
        expanded={inCollapsible ? inOpen : undefined}
        onToggle={inCollapsible ? () => setOpenIn((open) => !open) : undefined}
        metric={<DistanceMetric legs={inbound} ink={ACCENT_ORIGIN_INK} />}
      >
        {inbound.map((leg) => renderSubRow(leg, ACCENT_ORIGIN, ACCENT_ORIGIN_INK))}
      </MilestoneBand>

      <MilestoneBand
        segment="middle"
        state={facilityStage}
        title="Pyrolysis"
        accent={ACCENT_FACILITY_INK}
        completeIcon={MapPinIcon}
        metric={
          <span className={cn(MICRO_CAPS, "shrink-0 whitespace-nowrap font-normal tracking-[0.08em]", INK_MUTED)}>{inbound.length} in · {outbound.length} out</span>
        }
      />

      <MilestoneBand
        segment="end"
        state={outboundStage}
        title="Application out"
        accent={ACCENT_SITE_INK}
        divided={outbound.length > 0 && outOpen}
        expanded={outCollapsible ? outOpen : undefined}
        onToggle={outCollapsible ? () => setOpenOut((open) => !open) : undefined}
        metric={<DistanceMetric legs={outbound} ink={ACCENT_SITE_INK} />}
      >
        {outbound.map((leg) => renderSubRow(leg, ACCENT_SITE, ACCENT_SITE_INK))}
      </MilestoneBand>

      {noPosition.length > 0 ? (
        <NotOnMapCluster
          entries={noPosition}
          focusNodeIds={focusNodeIds}
          onNodeSelect={onSelectNode}
        />
      ) : null}
    </aside>
  );
}
