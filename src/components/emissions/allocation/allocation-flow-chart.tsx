/**
 * The Flow chart: visual language of the Traceability Sankey waterfall (light
 * plum blocks with a 1.25px plum stroke, the lit set in the pink accent, Not
 * yet allocated in the same hatch as water driven off). The SVG only draws; an
 * HTML button sits over every node, so hover, keyboard focus and tap go through
 * one element. The page's own batch or Removal is lit until another node is
 * hovered, focused or tapped.
 */
"use client";

import { useId } from "react";
import { HATCH_STROKE, LIT_FILL, LIT_INK, START_FILL, START_STROKE } from "@/components/ui/chart-tokens";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import { cn } from "@/lib/utils";
import { formatDay, formatValue, recordFacts } from "./allocation-format";
import { PERCENT_WHOLE } from "./allocation-model";
import { LANE_W, bandPath, litSet, ownerPercent, place, spread, type Graph, type Stream } from "./allocation-flow-graph";
import { MUTED } from "./allocation-parts";

const HIT_MIN_H = 44;
const STROKE = 1.25;
const LIT_STROKE = 1.5;
const HATCH_CELL = 6;
const PCT_GAP = 6;
const LIT_NODE_FILL = "color-mix(in srgb, var(--acc-dist) 18%, var(--paper))";
const QUIET_BAND_FILL = "var(--clr-dark-purple-10)";
const QUIET_BAND_STROKE = "var(--clr-dark-purple-20)";
const LIT_BAND_OPACITY = 0.5;
const QUIET_BAND_STROKE_W = 0.75;

export function FlowChart({ graph, stream, focusKey, activeKey, onHover, onToggle }: {
  graph: Graph;
  stream: Stream;
  focusKey: string;
  activeKey: string | null;
  onHover: (key: string | null) => void;
  onToggle: (key: string) => void;
}) {
  const hatchId = `alloc-hatch-${useId().replace(/:/g, "")}`;
  const [width, measure] = useMeasuredWidth();
  const { placed, height, blockW, lane } = place(graph, width);
  const byKey = new Map(placed.map((node) => [node.key, node]));
  const lit = litSet(graph, activeKey);
  const active = activeKey ? byKey.get(activeKey) : undefined;

  // Stack bands: out of a node in target order, into a node in source order.
  const outAt = new Map<string, number>();
  const inAt = new Map<string, number>();
  const drawn = graph.bands.map((band, index) => {
    const from = byKey.get(band.from);
    const to = byKey.get(band.to);
    if (!from || !to) return null;
    // A band takes its share of each end's height, so it always fits inside both.
    const h0 = (band.value / from.value) * from.h;
    const h1 = (band.value / to.value) * to.h;
    const y0 = from.y + (outAt.get(from.key) ?? 0);
    const y1 = to.y + (inAt.get(to.key) ?? 0);
    outAt.set(from.key, (outAt.get(from.key) ?? 0) + h0);
    inAt.set(to.key, (inAt.get(to.key) ?? 0) + h1);
    return { band, index, from, to, h0, h1, y0, y1 };
  });

  // Share labels: one per record, never two at one spot.
  const pct: { key: string; x: number; y: number; text: string; anchor: "start" | "end" }[] = [];
  if (active && active.kind !== "record") {
    for (const record of placed.filter((node) => node.kind === "record")) {
      const own = drawn.filter((d) => d && lit.bands.has(d.index) && d.from.key === record.key);
      if (!own.length || !record.record) continue;
      const top = Math.min(...own.map((d) => d!.y0));
      const bottom = Math.max(...own.map((d) => d!.y0 + d!.h0));
      const percent = ownerPercent(record.record, active, graph);
      if (percent > 0 && percent < PERCENT_WHOLE) pct.push({ key: record.key, x: record.x + blockW + PCT_GAP, y: (top + bottom) / 2, text: `${percent}%`, anchor: "start" });
    }
  } else if (active?.record) {
    for (const d of drawn) {
      if (!d || d.from.key !== active.key) continue;
      const percent = ownerPercent(active.record, d.to, graph);
      pct.push({ key: d.to.key, x: d.to.x - PCT_GAP, y: d.y1 + d.h1 / 2, text: `${percent}%`, anchor: "end" });
    }
  }
  spread(pct);

  return (
    <div ref={measure} className="w-full min-w-0">
      <div className="relative" style={{ width, height }} data-testid="allocation-flow">
        <svg width={width} height={height} aria-hidden className="absolute inset-0 overflow-visible">
          <defs>
            <pattern id={hatchId} width={HATCH_CELL} height={HATCH_CELL} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={HATCH_CELL} height={HATCH_CELL} fill="var(--paper)" />
              <line x1="0" y1="0" x2="0" y2={HATCH_CELL} stroke={HATCH_STROKE} strokeWidth={STROKE} />
            </pattern>
          </defs>
          {drawn.map((d) =>
            d && !lit.bands.has(d.index) ? (
              <path key={d.index} d={bandPath(d.from.x + blockW, d.y0, d.h0, d.to.x, d.y1, d.h1)} fill={QUIET_BAND_FILL} stroke={QUIET_BAND_STROKE} strokeWidth={QUIET_BAND_STROKE_W} />
            ) : null,
          )}
          {drawn.map((d) =>
            d && lit.bands.has(d.index) ? (
              <path key={d.index} d={bandPath(d.from.x + blockW, d.y0, d.h0, d.to.x, d.y1, d.h1)} fill={LIT_FILL} fillOpacity={LIT_BAND_OPACITY} stroke={LIT_FILL} strokeWidth={QUIET_BAND_STROKE_W} />
            ) : null,
          )}
          {placed.map((node) => {
            const isLit = lit.nodes.has(node.key) && node.kind === "owner";
            return (
              <rect
                key={node.key}
                x={node.x}
                y={node.y}
                width={blockW}
                height={node.h}
                fill={node.kind === "notYet" ? `url(#${hatchId})` : isLit ? LIT_NODE_FILL : START_FILL}
                stroke={node.key === focusKey ? "var(--ink)" : isLit ? LIT_FILL : START_STROKE}
                strokeWidth={node.key === focusKey || isLit ? LIT_STROKE : STROKE}
              />
            );
          })}
          {pct.map((label) => (
            <text key={label.key} x={label.x} y={label.y} textAnchor={label.anchor} dominantBaseline="middle" className="body-caption font-medium tabular-nums" fill={LIT_INK}>
              {label.text}
            </text>
          ))}
        </svg>

        {/* Record context in a lane to the left (wide screens). */}
        {lane > 0 &&
          placed
            .filter((node) => node.kind === "record" && node.record)
            .map((node) => {
              const [first, ...rest] = recordFacts(node.record!);
              return (
                <div
                  key={`lane-${node.key}`}
                  className="pointer-events-none absolute flex flex-col justify-center text-right"
                  style={{ left: 0, width: LANE_W, top: node.y + node.h / 2 - HIT_MIN_H / 2, height: HIT_MIN_H }}
                >
                  <span className={cn("truncate body-caption", MUTED)}>{formatDay(node.record!.date)}, {first}</span>
                  <span className={cn("truncate body-caption", MUTED)}>{rest.join(", ")}</span>
                </div>
              );
            })}

        {/* Labels inside the blocks. */}
        {placed.map((node) => {
          const isLit = lit.nodes.has(node.key) && node.kind === "owner";
          return (
            <div
              key={`label-${node.key}`}
              className="pointer-events-none absolute flex flex-col justify-center overflow-hidden px-6"
              style={{ left: node.x, top: node.y, width: blockW, height: node.h }}
            >
              <span className={cn("body-caption font-medium", node.kind === "notYet" ? "bg-[var(--paper)] self-start px-2" : "truncate")} style={{ color: isLit ? LIT_INK : "var(--color-text-primary)" }}>
                {node.label}
              </span>
              <span className={cn("truncate body-caption tabular-nums", node.kind === "notYet" && "bg-[var(--paper)] self-start px-2")} style={{ color: isLit ? LIT_INK : "var(--color-text-secondary)" }}>
                {formatValue(node.value, stream.unit)}
              </span>
            </div>
          );
        })}

        {/* One button per node, at least 44px tall. */}
        {placed.map((node) => {
          const h = Math.max(HIT_MIN_H, node.h);
          return (
            <button
              key={`hit-${node.key}`}
              type="button"
              data-node={node.key}
              aria-label={`${node.label}: ${formatValue(node.value, stream.unit)}`}
              aria-pressed={activeKey === node.key}
              className="absolute cursor-pointer bg-transparent outline-none focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-[var(--color-interaction)]"
              style={{ left: node.x, top: node.y + node.h / 2 - h / 2, width: blockW, height: h }}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") onHover(node.key);
              }}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(node.key)}
              onBlur={() => onHover(null)}
              onClick={() => onToggle(node.key)}
            />
          );
        })}
      </div>
    </div>
  );
}
