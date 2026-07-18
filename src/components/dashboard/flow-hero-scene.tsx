/**
 * FlowHeroScene — the desktop isometric line-art traceability scene
 * (supplier → feedstock → production → biochar → delivery → application).
 * The art is one responsive SVG (fixed viewBox, scales with the panel);
 * text chrome (station labels, mass chips, badges, tooltip) is HTML overlaid
 * at percentage coordinates so it stays crisp at every scale.
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
import { SCENE_BG } from "./flow-hero-defs";
import type { FlowHeroView } from "./flow-hero-types";
import "./flow-hero.css";

const VIEW_W = 1160;
/** The art lives between y≈150 and y≈490 — crop the empty sky above it so the
    hero has no dead band (the design's registry card that filled it moved to
    the supporting row). */
const VIEW_Y0 = 140;
const VIEW_H = 360;

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

const STATION_GEO: Record<DashboardStationKey, StationGeometry> = {
  suppliers: { index: "01", color: ZONE.prod, labelX: 100, tip: { x: 128, y: 306 } },
  feedstock: {
    index: "02",
    color: ZONE.prod,
    labelX: 320,
    badge: { x: 392, y: 256 },
    tip: { x: 420, y: 258 },
  },
  production: {
    index: "03",
    color: ZONE.infra,
    labelX: 545,
    badge: { x: 632, y: 230 },
    tip: { x: 652, y: 226 },
  },
  products: {
    index: "04",
    color: ZONE.prod,
    labelX: 745,
    badge: { x: 745, y: 300 },
    tip: { x: 808, y: 278 },
  },
  deliveries: {
    index: "05",
    color: ZONE.dist,
    labelX: 878,
    badge: { x: 872, y: 326 },
    tip: { x: 948, y: 356 },
  },
  applications: {
    index: "06",
    color: ZONE.dist,
    labelX: 1045,
    badge: { x: 1140, y: 318 },
    tip: { x: 900, y: 296 },
  },
};

const LABEL_Y = 456;
const REASON_Y = 474;

/** Mass-chip anchors between consecutive stations, in flow order. */
const CHIP_POS = [
  { x: 210, y: 432 },
  { x: 432, y: 433 },
  { x: 645, y: 435 },
  { x: 822, y: 434 },
  { x: 990, y: 434 },
];

/** Flow-view ribbon segments between station anchors on the road line. */
const RIBBON_PATHS = [
  { d: "M100,438 L320,434", color: ZONE.prod },
  { d: "M320,434 L545,437", color: ZONE.prod },
  { d: "M545,437 L745,435", color: ZONE.prod },
  { d: "M745,435 L900,436", color: ZONE.dist },
  { d: "M900,436 L1080,435", color: ZONE.dist },
];

/** Tooltips anchored past this x flip to the left of the anchor. */
const TIP_FLIP_X = 860;

function pctX(x: number): string {
  return `${(x / VIEW_W) * 100}%`;
}

function pctY(y: number): string {
  return `${((y - VIEW_Y0) / VIEW_H) * 100}%`;
}

export function formatTonnes(tonnes: number): string {
  const digits = tonnes >= 100 || tonnes === 0 ? 0 : 1;
  return `${tonnes.toLocaleString(undefined, {
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
        {/* Ground — supplier pad, central facility slab, application field ticks. */}
        <path
          d="M100,304 L196,352 L100,400 L4,352 Z"
          fill="var(--sea)"
          stroke="var(--clr-purple-20)"
          strokeWidth="1"
        />
        <path
          d="M205,352 L330,290 L760,290 L875,352 L760,414 L330,414 Z"
          fill="var(--sea)"
          stroke="var(--clr-purple-20)"
          strokeWidth="1"
        />
        <path
          d="M380,290 L380,281 M450,290 L450,281 M520,290 L520,281 M660,290 L660,281 M730,290 L730,281 M282,314 L282,305 M244,333 L244,324 M798,314 L798,305 M836,333 L836,324"
          stroke="var(--clr-dark-purple-30)"
          strokeWidth="1"
        />
        {/* The haul road with its marching dash. */}
        <path
          d="M40,436 C240,443 420,428 580,438 C740,447 940,430 1130,436"
          stroke="var(--clr-dark-purple-10)"
          strokeWidth="14"
        />
        <path
          d="M40,436 C240,443 420,428 580,438 C740,447 940,430 1130,436"
          stroke="var(--clr-dark-purple-40)"
          strokeWidth="1.5"
          strokeDasharray="8 12"
          className="fh-road"
        />
        <path
          d="M100,400 L100,430 M320,414 L320,430 M545,414 L545,432 M745,414 L745,430 M872,395 L872,430 M1045,386 L1045,430"
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
            <use href="#fh-heap" transform="translate(94,342)" />
            <use href="#fh-heap" transform="translate(142,350) scale(0.75)" />
            <use href="#fh-truck" transform="translate(24,384)" />
          </g>
        )}

        {/* 02 Feedstock — the bin rank up the slab. */}
        {byKey.get("feedstock") && (
          <g
            {...stationProps(byKey.get("feedstock")!)}
            style={stationStyle(byKey.get("feedstock")!)}
          >
            <use href="#fh-bin" transform="translate(280,352)" />
            <use href="#fh-bin" transform="translate(322,331)" />
            <use href="#fh-bin" transform="translate(364,310)" />
          </g>
        )}

        {/* 03 Production — drum kiln, feed hopper, chimney, chute + char pile. */}
        {byKey.get("production") && (
          <g
            {...stationProps(byKey.get("production")!)}
            style={stationStyle(byKey.get("production")!)}
          >
            {/* Infeed conveyor climbing into the hall's left wall. */}
            <path d="M468,352 L516,324 M472,356 L520,328" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M490,346 L490,358 M508,336 L508,350"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".5"
            />
            {/* The hall — lit right face, shaded left face, flat roof. */}
            <path
              d="M540,372 L640,322 L640,280 L540,330 Z"
              fill="currentColor"
              fillOpacity=".06"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M540,372 L504,354 L504,312 L540,330 Z"
              fill="currentColor"
              fillOpacity=".13"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M540,330 L640,280 L604,262 L504,312 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
            {/* Roller door with slats, vent strip under the roofline, skylight. */}
            <path
              d="M560,362 L596,344 L596,320 L560,338 Z"
              fill="currentColor"
              fillOpacity=".08"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path
              d="M560,354 L596,336 M560,346 L596,328"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".3"
            />
            <path d="M546,333 L634,289" stroke="currentColor" strokeWidth="1" strokeOpacity=".35" />
            <path
              d="M560,310 L580,300 L568,294 L548,304 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".35"
            />
            {/* Chimney — body masks the roof edge behind it. */}
            <path
              d="M587,216 L587,287 A7,3.5 0 0 0 601,287 L601,216"
              fill={SCENE_BG}
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <ellipse
              cx="594"
              cy="216"
              rx="7"
              ry="3.5"
              fill="currentColor"
              fillOpacity=".08"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            {/* Char discharge chute + fresh pile (product-zone tint). */}
            <path d="M628,326 L646,338 M621,330 L639,342" stroke="currentColor" strokeWidth="1.5" />
            <g color={ZONE.prod}>
              <path
                d="M642,352 L652,338 L664,344 L670,352 Z"
                fill="currentColor"
                fillOpacity=".3"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </g>
            {showSmoke && (
              <g fill="var(--clr-dark-purple-30)">
                <circle cx="594" cy="206" r="4.5" className="fh-smoke" />
                <circle cx="597" cy="204" r="6" className="fh-smoke" style={{ animationDelay: "-1.6s" }} />
                <circle cx="591" cy="205" r="7.5" className="fh-smoke" style={{ animationDelay: "-3.2s" }} />
              </g>
            )}
          </g>
        )}

        {/* 04 Biochar — the big-bag yard. */}
        {byKey.get("products") && (
          <g
            {...stationProps(byKey.get("products")!)}
            style={stationStyle(byKey.get("products")!)}
          >
            <use href="#fh-bag" transform="translate(730,328)" />
            <use href="#fh-bag" transform="translate(768,347)" />
            <use href="#fh-bag" transform="translate(688,349)" />
            <use href="#fh-bag" transform="translate(726,368)" />
          </g>
        )}

        {/* 05 Delivery — the outbound truck. */}
        {byKey.get("deliveries") && (
          <g
            {...stationProps(byKey.get("deliveries")!)}
            style={stationStyle(byKey.get("deliveries")!)}
          >
            <use href="#fh-truck" transform="translate(845,392)" />
          </g>
        )}

        {/* 06 Application — field, spread rows, trees, crop ticks. */}
        {byKey.get("applications") && (
          <g
            {...stationProps(byKey.get("applications")!)}
            style={stationStyle(byKey.get("applications")!)}
          >
            <path
              d="M1045,280 L1155,333 L1045,386 L935,333 Z"
              fill="var(--sea)"
              stroke="var(--clr-purple-20)"
              strokeWidth="1"
            />
            <path
              d="M957,344 L1067,291 M979,354 L1089,301 M1001,365 L1111,312 M1023,375 L1133,322"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".35"
            />
            <path d="M957,344 L1067,291 L1089,301 L979,354 Z" fill="var(--clr-dark-purple-20)" />
            <path d="M1001,365 L1111,312 L1133,322 L1023,375 Z" fill="var(--clr-dark-purple-20)" />
            <path
              d="M1045,378 L1155,325 M1045,382 L1155,329 M1045,378 L935,325 M1045,382 L935,329"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".5"
            />
            <path
              d="M1045,386 L1045,377 M1073,373 L1073,364 M1100,360 L1100,351 M1128,346 L1128,337 M1155,333 L1155,324 M1017,373 L1017,364 M990,360 L990,351 M962,346 L962,337 M935,333 L935,324"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeOpacity=".6"
            />
            <path d="M1080,290 L1080,279 M1120,308 L1120,297" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="1080" cy="271" r="10" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="1089" cy="275" r="6" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="1120" cy="289" r="11" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="1110" cy="293" r="6" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M971,325 L974,318 L977,325 M998,312 L1001,305 L1004,312 M1028,297 L1031,290 L1034,297 M1015,346 L1018,339 L1021,346 M1042,333 L1045,326 L1048,333 M1069,320 L1072,313 L1075,320"
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity=".55"
            />
          </g>
        )}
      </svg>

      {/* Station labels along the road. */}
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
              className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[12px] font-light text-[var(--st-wait)]"
              style={{
                left: pctX(STATION_GEO[station.key].labelX),
                top: pctY(REASON_Y),
              }}
              aria-hidden
            >
              {station.reasons.map((reason) => reason.text).join(" · ")}
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
            return (
              <div
                key={`badge-${station.key}`}
                className={[
                  "pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-full bg-[var(--st-wait)] font-[family-name:var(--font-mono)] font-medium leading-none text-white transition-all",
                  emphasized ? "px-10 py-6 text-[13px]" : "px-8 py-4 text-[10.5px]",
                ].join(" ")}
                style={{
                  left: pctX(badge.x),
                  top: pctY(badge.y),
                  boxShadow: "2px 2px 0 var(--clr-dark-purple-10)",
                }}
                aria-hidden
              >
                {station.attention}
              </div>
            );
          })}

      {/* Running-runs chip under the production badge (overview only). */}
      {interactive && view === "overview" && runningRuns > 0 && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--st-run)] px-8 py-4 font-[family-name:var(--font-mono)] text-[9px] font-medium uppercase leading-none tracking-[0.08em] text-white"
          style={{ left: pctX(632), top: pctY(238) }}
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
              Math.max(VIEW_Y0 + 12, Math.min(hoveredGeo.tip.y - 30, VIEW_Y0 + 200)),
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
                  background: reason.tone === "run" ? "var(--st-run)" : "var(--st-wait)",
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
