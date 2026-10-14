/**
 * The bin's level over time, above its stock history: dry biochar as the
 * solid band (the tracked quantity), ingredient solids where present, and
 * estimated water stacked on top as a hatched band. The top is wet stock.
 * Steps, not slopes: stock changes at an entry and holds until the next.
 */
"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { formatFacilityTime } from "@/lib/date-utils";
import { formatMassKg } from "@/lib/format-utils";
import { DetailsTooltip } from "./sub-bin-card";
import type { StockLevelPoint, StockModeChange } from "./stock-level-series";
export type { StockLevelPoint } from "./stock-level-series";

const VIEW_W = 600;
const VIEW_H = 168;
const VIEW_H_COMPACT = 120;
const HIT_MIN_W = 6;
const TOUCH_TARGET_PX = 44;
const TOOLTIP_DATE_FORMAT = "MMM d, yyyy, HH:mm";
const PAD = { left: 44, right: 12, top: 12, bottom: 24 } as const;
const Y_HEADROOM = 1.1;
const X_TICKS = 4;
const TICK_DATE_FORMAT = "MMM d";
const PERCENT = 100;
const AXIS_FONT_PX = 11;
const TICK_LABEL_GAP = 6;
const TICK_LABEL_BASELINE = 4;
const MODE_LABEL_OFFSET = { x: 4, y: 10 } as const;
const POINT_RADIUS = 3;
const POINT_STROKE = 1.5;

type Vertex = { x: number; y: number };

/** A step line's corners: hold each value until the next point, then to the chart's end. */
function stepVertices(points: readonly Vertex[], endX: number): Vertex[] {
  const corners = points.flatMap((p, i) => (i === 0 ? [p] : [{ x: p.x, y: points[i - 1].y }, p]));
  return [...corners, { x: endX, y: points[points.length - 1].y }];
}

function polyline(vertices: readonly Vertex[]): string {
  return vertices.map((v, i) => `${i === 0 ? "M" : "L"}${v.x} ${v.y}`).join(" ");
}

export function StockLevelChart({ points, modeChanges = [], timeZone, now, solidLabel = "Dry biochar", compact = false }: {
  points: StockLevelPoint[];
  modeChanges?: StockModeChange[];
  timeZone: string;
  now: number;
  /** The solid band: dry biochar, or a feedstock's estimated dry solids. */
  solidLabel?: string;
  /** The stock card's shorter version. */
  compact?: boolean;
}) {
  // Several bin cards can share a page, so each chart needs its own pattern id.
  const hatchId = `stock-water-hatch-${useId().replace(/:/g, "")}`;
  if (points.length === 0) return null;
  const viewH = compact ? VIEW_H_COMPACT : VIEW_H;
  const t0 = points[0].t;
  const t1 = Math.max(now, points[points.length - 1].t);
  const span = Math.max(t1 - t0, 1);
  const top = Math.max(...points.map((p) => p.dryKg + (p.ingredientsKg ?? 0) + (p.waterKg ?? 0)), 1) * Y_HEADROOM;
  const x = (t: number) => PAD.left + ((t - t0) / span) * (VIEW_W - PAD.left - PAD.right);
  const y = (kg: number) => viewH - PAD.bottom - (kg / top) * (viewH - PAD.top - PAD.bottom);
  const baseY = y(0);
  const endX = x(t1);
  const dryLine = points.map((p) => ({ x: x(p.t), y: y(p.dryKg) }));
  const wetLine = points.map((p) => ({ x: x(p.t), y: y(p.dryKg + (p.ingredientsKg ?? 0) + (p.waterKg ?? 0)) }));
  const hasWater = points.some((p) => p.waterKg !== null && p.waterKg > 0);
  const solidsLine = points.map((p) => ({ x: x(p.t), y: y(p.dryKg + (p.ingredientsKg ?? 0)) }));
  const solidsEdge = stepVertices(solidsLine, endX);
  const hasIngredients = points.some(p => (p.ingredientsKg ?? 0) > 0);
  const dryEdge = stepVertices(dryLine, endX);
  const wetEdge = stepVertices(wetLine, endX);
  const dryArea = `${polyline([...dryEdge, { x: endX, y: baseY }, { x: dryEdge[0].x, y: baseY }])} Z`;
  // The water band runs along the wet edge, then back along the solids edge.
  const waterArea = `${polyline([...wetEdge, ...[...solidsEdge].reverse()])} Z`;
  const ingredientsArea = `${polyline([...solidsEdge, ...[...dryEdge].reverse()])} Z`;
  const dataTop = top / Y_HEADROOM;
  const yTicks = [0, dataTop / 2, dataTop].map((kg) => Math.round(kg));
  const xTicks = Array.from({ length: X_TICKS }, (_, i) => t0 + (span * i) / (X_TICKS - 1));
  const last = points[points.length - 1];

  return (
    <figure className="flex flex-col gap-6">
      <div className="relative">
        <svg viewBox={`0 0 ${VIEW_W} ${viewH}`} className="block h-auto w-full" aria-hidden="true">
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="1.5" height="6" fill="var(--clr-dark-purple-30)" />
            </pattern>
          </defs>
          {yTicks.map((kg, index) => (
            <g key={index}>
              <line x1={PAD.left} x2={VIEW_W - PAD.right} y1={y(kg)} y2={y(kg)} stroke="var(--color-border-secondary)" strokeWidth="1" />
              <text x={PAD.left - TICK_LABEL_GAP} y={y(kg) + TICK_LABEL_BASELINE} textAnchor="end" fontSize={AXIS_FONT_PX} fill="var(--color-text-tertiary)">{kg.toLocaleString("en-US")}</text>
            </g>
          ))}
          {hasIngredients && <path d={ingredientsArea} fill="var(--acc-infra)" stroke="none" />}
          {hasWater && <path d={waterArea} fill={`url(#${hatchId})`} stroke="none" />}
          <path d={dryArea} fill="var(--clr-dark-purple-80)" stroke="none" />
          {hasWater && <path d={polyline(wetEdge)} fill="none" stroke="var(--clr-dark-purple-40)" strokeWidth="1" />}
          {modeChanges.map((change) => (
            <g key={change.t}>
              <line x1={x(change.t)} x2={x(change.t)} y1={PAD.top} y2={baseY} stroke="var(--clr-dark-purple-40)" strokeDasharray="3 3" />
              <text x={x(change.t) - MODE_LABEL_OFFSET.x} y={PAD.top + MODE_LABEL_OFFSET.y} textAnchor="end" fontSize={AXIS_FONT_PX} fill="var(--color-text-secondary)">{change.kind === "merge" ? "Mixed" : "Split"}</text>
            </g>
          ))}
          {dryLine.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={POINT_RADIUS} fill="var(--color-background-white)" stroke="var(--clr-dark-purple-100)" strokeWidth={POINT_STROKE} />)}
          {xTicks.map((t, i) => (
            <text key={t} x={x(t)} y={viewH - TICK_LABEL_GAP} fontSize={AXIS_FONT_PX} fill="var(--color-text-tertiary)" textAnchor={i === 0 ? "start" : i === X_TICKS - 1 ? "end" : "middle"}>
              {formatFacilityTime(new Date(t), timeZone, TICK_DATE_FORMAT)}
            </text>
          ))}
        </svg>
        {/* HTML triggers keep every step keyboard and touch accessible; the SVG is decorative. */}
        {points.map((point, index) => {
          const left = x(point.t);
          const right = index < points.length - 1 ? x(points[index + 1].t) : endX;
          const title = `${point.label ?? "Stock"}, ${formatFacilityTime(new Date(point.t), timeZone, TOOLTIP_DATE_FORMAT)}`;
          return <DetailsTooltip key={index} title={title} rows={[
            { label: solidLabel, value: formatMassKg(point.dryKg) },
            ...((point.ingredientsKg ?? 0) > 0 ? [{ label: "Ingredients, dry", value: formatMassKg(point.ingredientsKg) }] : []),
            { label: "Water, estimated", value: formatMassKg(point.waterKg) },
            { label: "Wet, estimated", value: formatMassKg(point.waterKg === null ? null : point.dryKg + (point.ingredientsKg ?? 0) + point.waterKg) },
          ]} trigger={<Button type="button" variant="noOutline" aria-label={`${title} details`}
            className="absolute min-h-44 min-w-44 rounded-none p-0 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset"
            style={{ left: `min(${left / VIEW_W * PERCENT}%, calc(100% - ${TOUCH_TARGET_PX}px))`, width: `${Math.max(right - left, HIT_MIN_W) / VIEW_W * PERCENT}%`, top: `${PAD.top / viewH * PERCENT}%`, height: `${(baseY - PAD.top) / viewH * PERCENT}%` }} />} />;
        })}
      </div>
      <figcaption className="flex flex-wrap gap-x-16 gap-y-4 body-caption text-[var(--color-text-secondary)]">
        <span className="inline-flex items-center gap-6"><span aria-hidden="true" className="inline-block h-12 w-12 bg-[var(--clr-dark-purple-80)]" />{solidLabel} {formatMassKg(last.dryKg)}</span>
        {hasIngredients && <span className="inline-flex items-center gap-6"><span aria-hidden="true" className="inline-block h-12 w-12 bg-[var(--acc-infra)]" />Ingredients, dry {formatMassKg(last.ingredientsKg)}</span>}
        {hasWater && <span className="inline-flex items-center gap-6"><span aria-hidden="true" className="inline-block h-12 w-12 border border-[var(--color-border-secondary)] moisture-water-hatch" />Water, estimated {formatMassKg(last.waterKg)}</span>}
      </figcaption>
    </figure>
  );
}
