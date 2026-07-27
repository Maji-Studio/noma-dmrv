/**
 * FlowHeroScene — the desktop isometric line-art traceability scene
 * (supplier → feedstock → production → biochar → delivery → application).
 * The art is one responsive SVG (fixed viewBox, scales with the panel);
 * text chrome (station labels, mass chips, badges, tooltip) is HTML overlaid
 * at percentage coordinates so it stays crisp at every scale.
 *
 * Staging is on a fixed six-bay grid (BAY_FIRST_X + n·BAY_PITCH): every station
 * is centred in its own bay, on one continuous ground plane, over a straight
 * mass-flow rail. Labels, leader lines, mass chips and flow ribbons all derive
 * from the same bay centres, so the row keeps an even rhythm and nothing is
 * hand-nudged out of alignment.
 *
 * Stations are keyboard-focusable links; the hover/focus tooltip repeats the
 * station's open items and throughput, and the whole station navigates to its
 * list page. All decorative motion is disabled under prefers-reduced-motion
 * (see flow-hero.css).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DashboardMassFlowSegment,
  DashboardStation,
  DashboardStationKey,
} from "@/data-access/dashboard-overview";
import { STATUS_STATE_COLOR_TOKENS } from "@/lib/status-state";
import { deriveWorstDashboardState } from "./dashboard-status-state";
import { SCENE_BG } from "./flow-hero-defs";
import type { FlowHeroView } from "./flow-hero-types";
import "./flow-hero.css";

const VIEW_W = 1160;
/** The art lives between y≈244 (smoke) and y≈482 (attention reasons) — the
    viewBox is cropped to it so the hero carries no dead sky. */
const VIEW_Y0 = 235;
const VIEW_H = 265;

/** Station bay grid — six equal bays, each station centred in its own. */
const BAY_FIRST_X = 120;
const BAY_PITCH = 180;
const BAY_CENTERS = [0, 1, 2, 3, 4, 5].map(
  (index) => BAY_FIRST_X + index * BAY_PITCH,
);
/** Midpoints between consecutive bays — mass chips and ground ticks. */
const BAY_EDGES = BAY_CENTERS.slice(0, -1).map(
  (center) => center + BAY_PITCH / 2,
);

/** The straight mass-flow rail carrying the chips and the flow ribbons. */
const RAIL_Y = 446;
const LABEL_Y = 464;
const REASON_Y = 482;

/** Ribbon stroke width range in flow view (px, min → min+span, scaled by tonnes/max). */
const RIBBON_MIN_WIDTH = 5;
const RIBBON_WIDTH_SPAN = 20;

/** Accent tint per chain zone — always the ink variants (contrast-safe). */
const ZONE = {
  prod: "var(--acc-prod-ink)",
  infra: "var(--acc-infra-ink)",
  dist: "var(--acc-dist-ink)",
} as const;

interface StationGeometry {
  /** Chain position label, e.g. "01". */
  index: string;
  color: string;
  labelX: number;
  /** Attention badge anchor (absent = station never badges). */
  badge?: { x: number; y: number };
  /** Tooltip anchor. */
  tip: { x: number; y: number };
}

/** Badges anchor to the top-right of each station's drawn mass, so the count
    always reads as belonging to that station and never collides with a
    neighbour or the running-runs chip. */
const STATION_GEO: Record<DashboardStationKey, StationGeometry> = {
  suppliers: {
    index: "01",
    color: ZONE.prod,
    labelX: BAY_CENTERS[0]!,
    tip: { x: 200, y: 352 },
  },
  feedstock: {
    index: "02",
    color: ZONE.prod,
    labelX: BAY_CENTERS[1]!,
    badge: { x: 358, y: 344 },
    tip: { x: 360, y: 348 },
  },
  production: {
    index: "03",
    color: ZONE.infra,
    labelX: BAY_CENTERS[2]!,
    badge: { x: 550, y: 318 },
    tip: { x: 560, y: 334 },
  },
  products: {
    index: "04",
    color: ZONE.prod,
    labelX: BAY_CENTERS[3]!,
    badge: { x: 728, y: 322 },
    tip: { x: 730, y: 340 },
  },
  deliveries: {
    index: "05",
    color: ZONE.dist,
    labelX: BAY_CENTERS[4]!,
    badge: { x: 881, y: 336 },
    tip: { x: 885, y: 348 },
  },
  applications: {
    index: "06",
    color: ZONE.dist,
    labelX: BAY_CENTERS[5]!,
    badge: { x: 1098, y: 330 },
    tip: { x: 1104, y: 340 },
  },
};

/** Running-runs chip — stacked above the production badge, never beside it. */
const RUNNING_CHIP = { x: 550, y: 292 };

/** Mass-chip anchors — the bay midpoints, sitting on the rail. */
const CHIP_POS = BAY_EDGES.map((x) => ({ x, y: RAIL_Y }));

/** Flow-view ribbon segments between station anchors on the rail. */
const RIBBON_PATHS = BAY_CENTERS.slice(0, -1).map((center, index) => ({
  d: `M${center},${RAIL_Y} L${BAY_CENTERS[index + 1]},${RAIL_Y}`,
  color: index < 3 ? ZONE.prod : ZONE.dist,
}));

/** Leader lines dropping each bay centre onto the rail. */
const LEADER_PATH = BAY_CENTERS.map(
  (center) => `M${center},410 L${center},438`,
).join(" ");

/** Ground ticks on the slab's back edge, marking the bay divisions. */
const GROUND_TICK_PATH = BAY_EDGES.map((x) => `M${x},316 L${x},309`).join(" ");

/** Tooltips anchored past this x flip to the left of the anchor. */
const TIP_FLIP_X = 880;
/** Tooltip vertical clamp — keeps the card inside the (short) scene box. */
const TIP_MIN_Y = VIEW_Y0 + 12;
const TIP_MAX_Y = VIEW_Y0 + 70;

function pctX(x: number): string {
  return `${(x / VIEW_W) * 100}%`;
}

function pctY(y: number): string {
  return `${((y - VIEW_Y0) / VIEW_H) * 100}%`;
}

/** Pinned so server and client format the number identically (no hydration drift). */
const TONNES_LOCALE = "en-US";

export function formatTonnes(tonnes: number): string {
  const digits = tonnes >= 100 || tonnes === 0 ? 0 : 1;
  return `${tonnes.toLocaleString(TONNES_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })} t`;
}

function stationAria(station: DashboardStation): string {
  const parts = [`${station.name} — ${station.totalLabel}`];
  if (station.reasons.length > 0) {
    parts.push(station.reasons.map((reason) => reason.text).join(", "));
  } else {
    parts.push("no open items");
  }
  return parts.join(", ");
}

interface FlowHeroSceneProps {
  stations: DashboardStation[];
  massFlow: DashboardMassFlowSegment[];
  runningRuns: number;
  view: FlowHeroView;
  /** Loading / empty — art desaturates and interaction chrome hides. */
  ghosted: boolean;
}

export function FlowHeroScene({
  stations,
  massFlow,
  runningRuns,
  view,
  ghosted,
}: FlowHeroSceneProps) {
  const router = useRouter();
  const [hovered, setHovered] = useState<DashboardStationKey | null>(null);

  const byKey = new Map(stations.map((station) => [station.key, station]));
  const maxTonnes = Math.max(...massFlow.map((segment) => segment.tonnes), 0);

  const stationStyle = (station: DashboardStation): React.CSSProperties => {
    let opacity = 1;
    let filter = "none";
    if (ghosted) {
      opacity = 0.25;
      filter = "grayscale(1)";
    } else if (view === "flow") {
      opacity = 0.4;
    } else if (view === "attention" && station.attention === 0) {
      opacity = 0.3;
      filter = "grayscale(1)";
    }
    return { color: STATION_GEO[station.key].color, opacity, filter };
  };

  const interactive = !ghosted;
  const showChips = interactive && view !== "attention";
  const showBadges = interactive && view !== "flow";
  const showReasons = interactive && view === "attention";
  const showRibbons = interactive && view === "flow" && maxTonnes > 0;
  const showSmoke = interactive && view === "overview";

  const stationProps = (station: DashboardStation) =>
    interactive
      ? {
          role: "link" as const,
          tabIndex: 0,
          "aria-label": stationAria(station),
          className: "fh-station",
          onClick: () => router.push(station.href),
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              router.push(station.href);
            }
          },
          onMouseEnter: () => setHovered(station.key),
          onMouseLeave: () => setHovered(null),
          onFocus: () => setHovered(station.key),
          onBlur: () => setHovered(null),
        }
      : { "aria-hidden": true };

  const hoveredStation = hovered ? byKey.get(hovered) : undefined;
  const hoveredGeo = hovered ? STATION_GEO[hovered] : undefined;
  // Outgoing segment index per station (application has no outgoing mass).
  const outIndex: Partial<Record<DashboardStationKey, number>> = {
    suppliers: 0,
    feedstock: 1,
    production: 2,
    products: 3,
    deliveries: 4,
  };

  return (
    <div
      className="relative hidden w-full overflow-hidden md:block"
      style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}`, background: SCENE_BG }}
      data-testid="flow-hero-scene"
    >
      {/* Not aria-hidden: the station <g role="link"> groups inside are
          keyboard-focusable, so hiding the whole SVG would trap focusable
          nodes in hidden content. Decorative shapes are bare (presentational)
          and non-interactive station groups carry aria-hidden themselves. */}
      <svg
        viewBox={`0 ${VIEW_Y0} ${VIEW_W} ${VIEW_H}`}
        fill="none"
        className="absolute inset-0 h-full w-full transition-[filter,opacity] duration-500"
        style={ghosted ? { filter: "grayscale(1)", opacity: 0.25 } : undefined}
        focusable="false"
      >
        {/* Ground — one continuous slab under every station, its isometric
            tips running off both frame edges so the site reads as continuing
            past the panel rather than sitting on a floating island. */}
        <path
          d="M-30,362 L62,316 L1098,316 L1190,362 L1098,408 L62,408 Z"
          fill="var(--sea)"
          stroke="var(--clr-purple-20)"
          strokeWidth="1"
        />
        <path
          d={GROUND_TICK_PATH}
          stroke="var(--clr-dark-purple-30)"
          strokeWidth="1"
        />

        {/* The straight mass-flow rail with its marching dash. */}
        <path
          d={`M30,${RAIL_Y} L1130,${RAIL_Y}`}
          stroke="var(--clr-dark-purple-5)"
          strokeWidth="12"
        />
        <path
          d={`M30,${RAIL_Y} L1130,${RAIL_Y}`}
          stroke="var(--clr-dark-purple-40)"
          strokeWidth="1.5"
          strokeDasharray="8 12"
          className="fh-road"
        />
        <path
          d={LEADER_PATH}
          stroke="var(--clr-dark-purple-30)"
          strokeWidth="1"
          strokeDasharray="2 4"
        />

        {/* Flow-view mass ribbons. */}
        {showRibbons && (
          <g strokeLinecap="butt" opacity=".35">
            {RIBBON_PATHS.map((ribbon, index) => (
              <path
                key={ribbon.d}
                d={ribbon.d}
                stroke={ribbon.color}
                strokeWidth={
                  RIBBON_MIN_WIDTH +
                  ((massFlow[index]?.tonnes ?? 0) / maxTonnes) * RIBBON_WIDTH_SPAN
                }
              />
            ))}
          </g>
        )}

        {/* 01 Supplier — heaps + inbound truck. */}
        {byKey.get("suppliers") && (
          <g
            {...stationProps(byKey.get("suppliers")!)}
            style={stationStyle(byKey.get("suppliers")!)}
          >
            <use href="#fh-heap" transform="translate(43,370) scale(1.1)" />
            <use href="#fh-heap" transform="translate(87,380) scale(0.8)" />
            <use href="#fh-truck" transform="translate(129,400)" />
          </g>
        )}

        {/* 02 Feedstock — a bin cluster, two front and one set back. */}
        {byKey.get("feedstock") && (
          <g
            {...stationProps(byKey.get("feedstock")!)}
            style={stationStyle(byKey.get("feedstock")!)}
          >
            <use href="#fh-bin" transform="translate(300,380) scale(1.15)" />
            <use href="#fh-bin" transform="translate(262,398) scale(1.15)" />
            <use href="#fh-bin" transform="translate(338,398) scale(1.15)" />
          </g>
        )}

        {/* 03 Production — hall, feed conveyor, chimney, discharge chute. */}
        {byKey.get("production") && (
          <g
            {...stationProps(byKey.get("production")!)}
            style={stationStyle(byKey.get("production")!)}
          >
            {/* Infeed conveyor climbing into the hall's left wall. */}
            <path d="M404,376 L426,364 M407,381 L429,369" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M413,371 L413,380 M421,366 L421,375"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".5"
            />
            {/* The hall — lit right face, shaded left face, flat roof. */}
            <path
              d="M454,400 L540,357 L540,320 L454,363 Z"
              fill="currentColor"
              fillOpacity=".06"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M454,400 L422,384 L422,347 L454,363 Z"
              fill="currentColor"
              fillOpacity=".13"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M454,363 L540,320 L508,304 L422,347 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
            {/* Roller door with slats, vent strip under the roofline, skylight. */}
            <path
              d="M470,392 L502,376 L502,355 L470,371 Z"
              fill="currentColor"
              fillOpacity=".08"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path
              d="M470,384 L502,368 M470,377 L502,361"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".3"
            />
            <path d="M460,365 L534,328" stroke="currentColor" strokeWidth="1" strokeOpacity=".35" />
            <path
              d="M470,342 L488,333 L477,328 L459,337 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".35"
            />
            {/* Chimney — body masks the roof edge behind it. */}
            <path
              d="M481,278 L481,313 A8,4 0 0 0 497,313 L497,278"
              fill={SCENE_BG}
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <ellipse
              cx="489"
              cy="278"
              rx="8"
              ry="4"
              fill="currentColor"
              fillOpacity=".08"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            {/* Char discharge chute. */}
            <path d="M538,354 L556,365 M533,358 L551,369" stroke="currentColor" strokeWidth="1.5" />
            {showSmoke && (
              <g fill="var(--clr-dark-purple-30)">
                <circle cx="489" cy="268" r="4" className="fh-smoke" />
                <circle cx="492" cy="260" r="5.5" className="fh-smoke" style={{ animationDelay: "-1.6s" }} />
                <circle cx="486" cy="251" r="7" className="fh-smoke" style={{ animationDelay: "-3.2s" }} />
              </g>
            )}
          </g>
        )}

        {/* 04 Biochar — the big-bag yard, stacked on an isometric diamond. */}
        {byKey.get("products") && (
          <g
            {...stationProps(byKey.get("products")!)}
            style={stationStyle(byKey.get("products")!)}
          >
            <use href="#fh-bag" transform="translate(660,354) scale(1.1)" />
            <use href="#fh-bag" transform="translate(614,377) scale(1.1)" />
            <use href="#fh-bag" transform="translate(706,377) scale(1.1)" />
            <use href="#fh-bag" transform="translate(660,400) scale(1.1)" />
          </g>
        )}

        {/* 05 Delivery — the outbound truck. */}
        {byKey.get("deliveries") && (
          <g
            {...stationProps(byKey.get("deliveries")!)}
            style={stationStyle(byKey.get("deliveries")!)}
          >
            <use href="#fh-truck" transform="translate(815,400)" />
          </g>
        )}

        {/* 06 Application — field, spread rows, trees, crop ticks. */}
        {byKey.get("applications") && (
          <g
            {...stationProps(byKey.get("applications")!)}
            style={stationStyle(byKey.get("applications")!)}
          >
            <path
              d="M1020,318 L1100,358 L1020,398 L940,358 Z"
              fill="var(--sea)"
              stroke="var(--clr-purple-20)"
              strokeWidth="1"
            />
            <path d="M956,366 L1036,326 L1052,334 L972,374 Z" fill="var(--clr-dark-purple-10)" />
            <path d="M988,382 L1068,342 L1084,350 L1004,390 Z" fill="var(--clr-dark-purple-10)" />
            <path
              d="M956,366 L1036,326 M972,374 L1052,334 M988,382 L1068,342 M1004,390 L1084,350"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".35"
            />
            <path
              d="M1020,390 L1100,350 M1020,394 L1100,354 M1020,390 L940,350 M1020,394 L940,354"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".5"
            />
            <path
              d="M1020,398 L1020,389 M1040,388 L1040,379 M1060,378 L1060,369 M1080,368 L1080,359 M1100,358 L1100,349 M1000,388 L1000,379 M980,378 L980,369 M960,368 L960,359 M940,358 L940,349"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeOpacity=".6"
            />
            <path
              d="M997,378 L1000,370 L1003,378 M1019,390 L1022,382 L1025,390 M1037,378 L1040,370 L1043,378 M1007,356 L1010,348 L1013,356 M1075,366 L1078,358 L1081,366 M959,366 L962,358 L965,366"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".55"
            />
            <path d="M982,350 L982,339 M1062,352 L1062,341" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="982" cy="332" r="11" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="992" cy="336" r="6.5" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="1062" cy="334" r="11" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="1052" cy="338" r="6.5" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.5" />
          </g>
        )}
      </svg>

      {/* Station labels along the rail. */}
      {stations.map((station) => {
        const geo = STATION_GEO[station.key];
        return (
          <div
            key={`label-${station.key}`}
            className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]"
            style={{
              left: pctX(geo.labelX),
              top: pctY(LABEL_Y),
              opacity: stationStyle(station).opacity,
            }}
            aria-hidden
          >
            {geo.index} {station.name}
          </div>
        );
      })}

      {/* Attention reasons under the labels (attention view only). */}
      {showReasons &&
        stations
          .filter((station) => station.attention > 0 && station.reasons.length > 0)
          .map((station) => (
            <div
              key={`reason-${station.key}`}
              className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[12px] font-light"
              style={{
                left: pctX(STATION_GEO[station.key].labelX),
                top: pctY(REASON_Y),
              }}
              aria-hidden
            >
              {station.reasons.map((reason, index) => (
                <span
                  key={reason.text}
                  style={{ color: STATUS_STATE_COLOR_TOKENS[reason.state] }}
                >
                  {index > 0 ? " · " : ""}
                  {reason.text}
                </span>
              ))}
            </div>
          ))}

      {/* Mass chips between stations. */}
      {showChips &&
        CHIP_POS.map((pos, index) => {
          const segment = massFlow[index];
          if (!segment || (view === "overview" && segment.tonnes === 0)) return null;
          const emphasized = view === "flow";
          return (
            <div
              key={`chip-${segment.key}`}
              className={[
                "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap border border-[var(--clr-dark-purple-30)] font-[family-name:var(--font-mono)] leading-none transition-all",
                emphasized ? "px-8 py-4 text-[11.5px]" : "px-6 py-4 text-[9.5px]",
              ].join(" ")}
              style={{ left: pctX(pos.x), top: pctY(pos.y), background: SCENE_BG }}
              aria-hidden
            >
              {formatTonnes(segment.tonnes)}
            </div>
          );
        })}

      {/* Attention badges. */}
      {showBadges &&
        stations
          .filter((station) => station.attention > 0 && STATION_GEO[station.key].badge)
          .map((station) => {
            const badge = STATION_GEO[station.key].badge!;
            const emphasized = view === "attention";
            const stationState = deriveWorstDashboardState(
              station.reasons.map((reason) => reason.state),
            );
            return (
              <div
                key={`badge-${station.key}`}
                className={[
                  "pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-full font-[family-name:var(--font-mono)] font-medium leading-none text-white transition-all",
                  emphasized ? "px-10 py-6 text-[13px]" : "px-8 py-4 text-[10.5px]",
                ].join(" ")}
                style={{
                  left: pctX(badge.x),
                  top: pctY(badge.y),
                  background: STATUS_STATE_COLOR_TOKENS[stationState],
                  boxShadow: "2px 2px 0 var(--clr-dark-purple-10)",
                }}
                aria-hidden
              >
                {station.attention}
              </div>
            );
          })}

      {/* Running-runs chip, stacked above the production badge (overview only). */}
      {interactive && view === "overview" && runningRuns > 0 && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full px-8 py-4 font-[family-name:var(--font-mono)] text-[9px] font-medium uppercase leading-none tracking-[0.08em] text-white"
          style={{
            left: pctX(RUNNING_CHIP.x),
            top: pctY(RUNNING_CHIP.y),
            background: STATUS_STATE_COLOR_TOKENS["in-progress"],
          }}
          aria-hidden
        >
          {runningRuns} running
        </div>
      )}

      {/* Hover/focus tooltip — presentation only; the station link carries the a11y. */}
      {interactive && hoveredStation && hoveredGeo && (
        <div
          className="pointer-events-none absolute z-[5] w-[264px] border-[1.5px] border-[var(--ink)] bg-[var(--paper)] p-16"
          style={{
            left: pctX(hoveredGeo.tip.x),
            top: pctY(
              Math.max(TIP_MIN_Y, Math.min(hoveredGeo.tip.y - 30, TIP_MAX_Y)),
            ),
            transform: hoveredGeo.tip.x > TIP_FLIP_X ? "translateX(-100%)" : undefined,
            boxShadow: "6px 6px 0 var(--clr-purple-10)",
          }}
          aria-hidden
        >
          <div className="flex items-baseline justify-between gap-10">
            <div className="text-[16px] font-bold">{hoveredStation.name}</div>
            <div className="whitespace-nowrap font-[family-name:var(--font-mono)] text-[9.5px] uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]">
              {hoveredStation.totalLabel}
            </div>
          </div>
          {hoveredStation.reasons.map((reason) => (
            <div key={reason.text} className="mt-8 flex items-center gap-8">
              <span
                className="h-8 w-8 flex-none rounded-full"
                style={{
                  background: STATUS_STATE_COLOR_TOKENS[reason.state],
                }}
              />
              <span className="text-[12.5px] font-light">{reason.text}</span>
            </div>
          ))}
          {outIndex[hoveredStation.key] != null && (
            <div className="mt-10 border-t border-[var(--clr-dark-purple-10)] pt-8 font-[family-name:var(--font-mono)] text-[9.5px] uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]">
              Out → {formatTonnes(massFlow[outIndex[hoveredStation.key]!]?.tonnes ?? 0)} in
              period
            </div>
          )}
          <div className="mt-10 font-[family-name:var(--font-mono)] text-[10.5px] uppercase tracking-[0.06em]">
            View all →
          </div>
        </div>
      )}
    </div>
  );
}
