"use client";

/**
 * PROTOTYPE (Sankey variants A and B): the waterfall in kg, drawn 1:1 at the
 * measured width so every label stays at its real size. Anatomy from the
 * product page's Emissions section: a full first column, each step a small
 * hatched box stepping down (water dashed), dotted connectors carrying the
 * level across, the value above each column, a quiet y axis with gridlines,
 * an icon and a label under every column, brackets grouping the steps by the
 * records they leave from, and the last column lit.
 *
 * The SVG only draws; each column is an HTML button over it (44px wide at the
 * least), so hover, focus and tap all go through one element.
 */
import { useId } from "react";
import { cn } from "@/lib/utils";
import {
  HATCH_STROKE,
  ItemIcon,
  LIT_FILL,
  LIT_INK,
  signedKg,
  STAGE_ICONS,
  START_FILL,
  START_STROKE,
  STEP_STROKE,
  WATER_DASH,
} from "./waterfall-shared";
import { levelAfter, type WaterfallItemKey, type WaterfallModel } from "./waterfall-model";

const AXIS_W = 56;
const GROUP_GAP = 24;
const MAX_COL_W = 56;
const MIN_COL_W = 20;
const COL_SHARE = 0.5;
const TOP_PAD = 32;
const LABEL_TOP = 10;
/** Icon, gap and two label lines. */
const LABEL_BLOCK_H = 60;
const BRACKET_DROP = 6;
const BRACKET_LABEL_H = 28;
const MIN_STEP_H = 2;
const DIM_OPACITY = 0.4;
const TICK_TARGET = 4;

function niceStep(max: number): number {
  if (max <= 0) return 1;
  const raw = max / TICK_TARGET;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const factor = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return factor * power;
}

interface WaterfallChartProps {
  model: WaterfallModel;
  width: number;
  plotHeight: number;
  activeKey: WaterfallItemKey | null;
  pinnedKey: WaterfallItemKey | null;
  onHover: (key: WaterfallItemKey | null) => void;
  onSelect: (key: WaterfallItemKey) => void;
}

export function WaterfallChart({
  model,
  width,
  plotHeight,
  activeKey,
  pinnedKey,
  onHover,
  onSelect,
}: WaterfallChartProps) {
  const hatchId = `wf-hatch-${useId().replace(/:/g, "")}`;
  const { items, groups } = model;
  const stageBreaks = items.map((item, index) => index > 0 && items[index - 1].stage !== item.stage);
  const gapsBefore = stageBreaks.map((_, index) => stageBreaks.slice(0, index + 1).filter(Boolean).length);
  const totalGaps = gapsBefore[gapsBefore.length - 1] ?? 0;
  const pitch = Math.max(0, (width - AXIS_W - totalGaps * GROUP_GAP) / Math.max(1, items.length));
  const colW = Math.max(MIN_COL_W, Math.min(MAX_COL_W, pitch * COL_SHARE));
  const colX = (index: number) => AXIS_W + index * pitch + gapsBefore[index] * GROUP_GAP + (pitch - colW) / 2;
  const centerX = (index: number) => colX(index) + colW / 2;

  const step = niceStep(model.startKg);
  const axisMax = Math.max(step, Math.ceil(model.startKg / step) * step);
  const ticks = Array.from({ length: Math.round(axisMax / step) + 1 }, (_, index) => index * step);
  const base = TOP_PAD + plotHeight;
  const scale = plotHeight / axisMax;
  const y = (kg: number) => base - kg * scale;
  const bracketY = base + LABEL_TOP + LABEL_BLOCK_H;
  const height = bracketY + (groups.length > 0 ? BRACKET_DROP + BRACKET_LABEL_H : 0);
  const indexOf = (key: WaterfallItemKey) => items.findIndex((item) => item.key === key);

  return (
    <div className="relative" style={{ width, height }} data-testid="sankey-waterfall">
      <svg width={width} height={height} aria-hidden className="absolute inset-0 overflow-visible">
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={HATCH_STROKE} strokeWidth="1.25" />
          </pattern>
        </defs>
        <text x={0} y={12} className="fill-[var(--color-text-tertiary)] font-mono text-[10px] uppercase tracking-[0.08em]">kg</text>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={AXIS_W - 8}
              x2={width}
              y1={y(tick)}
              y2={y(tick)}
              stroke={tick === 0 ? "var(--clr-dark-purple-40)" : "var(--clr-dark-purple-10)"}
              strokeWidth={1}
            />
            <text
              x={AXIS_W - 14}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-[var(--color-text-tertiary)] font-mono text-[10px] tabular-nums"
            >
              {tick.toLocaleString()}
            </text>
          </g>
        ))}
        {items.slice(0, -1).map((item, index) => (
          <line
            key={`link-${item.key}`}
            x1={colX(index) + colW}
            x2={colX(index + 1)}
            y1={y(levelAfter(item))}
            y2={y(levelAfter(item))}
            stroke="var(--clr-dark-purple-60)"
            strokeWidth={1.25}
            strokeDasharray="1 4"
            strokeLinecap="round"
          />
        ))}
        {items.map((item, index) => {
          const dim = activeKey != null && activeKey !== item.key && item.kind !== "end";
          const top = y(item.top);
          const h = Math.max(item.kind === "step" ? MIN_STEP_H : 1, (item.top - item.bottom) * scale);
          const fill = item.kind === "step" ? `url(#${hatchId})` : item.kind === "end" ? LIT_FILL : START_FILL;
          const stroke = item.kind === "step" ? STEP_STROKE : item.kind === "end" ? LIT_FILL : START_STROKE;
          const isActive = activeKey === item.key;
          return (
            <g key={item.key} opacity={dim ? DIM_OPACITY : 1}>
              <rect
                x={colX(index)}
                y={top}
                width={colW}
                height={h}
                fill={fill}
                stroke={isActive && item.kind !== "end" ? "var(--clr-dark-purple-100)" : stroke}
                strokeWidth={1.25}
                strokeDasharray={item.key === "water_driven_off" ? WATER_DASH : undefined}
              />
              <text
                x={centerX(index)}
                y={top - 10}
                textAnchor="middle"
                className={cn(
                  "font-light tabular-nums",
                  item.kind === "step" ? "text-[14px]" : "text-[20px]",
                )}
                fill={item.kind === "end" ? LIT_INK : item.kind === "step" ? "var(--color-text-secondary)" : "var(--color-text-primary)"}
              >
                {signedKg(item)}
              </text>
            </g>
          );
        })}
        {groups.map((group) => {
          const first = indexOf(group.keys[0]);
          const last = indexOf(group.keys[group.keys.length - 1]);
          const x1 = colX(first);
          const x2 = colX(last) + colW;
          return (
            <path
              key={group.stage}
              d={`M${x1} ${bracketY}v${BRACKET_DROP}H${x2}v-${BRACKET_DROP}`}
              fill="none"
              stroke="var(--clr-dark-purple-20)"
              strokeWidth={1}
            />
          );
        })}
      </svg>

      {/* Icon and label under every column (HTML, so labels wrap at real size). */}
      {items.map((item, index) => {
        const lit = item.kind === "end";
        return (
          <div
            key={`label-${item.key}`}
            className="pointer-events-none absolute flex flex-col items-center gap-4 text-center"
            style={{ left: centerX(index) - pitch / 2, width: pitch, top: base + LABEL_TOP }}
          >
            <ItemIcon item={item} size={20} />
            <span
              className={cn("body-caption px-4 leading-[16px]", pinnedKey === item.key && "font-medium")}
              style={{ color: lit ? LIT_INK : activeKey === item.key || pinnedKey === item.key ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}
            >
              {item.label}
            </span>
          </div>
        );
      })}

      {groups.map((group) => {
        const first = indexOf(group.keys[0]);
        const last = indexOf(group.keys[group.keys.length - 1]);
        const x1 = colX(first);
        const x2 = colX(last) + colW;
        const StageIcon = STAGE_ICONS[group.stage];
        const labelW = Math.max(x2 - x1, pitch);
        return (
          <div
            key={`bracket-${group.stage}`}
            className="pointer-events-none absolute flex items-center justify-center gap-4 text-[var(--color-text-tertiary)]"
            style={{ left: (x1 + x2) / 2 - labelW / 2, width: labelW, top: bracketY + BRACKET_DROP + 6 }}
          >
            <StageIcon size={12} aria-hidden />
            <span className="body-caption whitespace-nowrap">{group.label}</span>
          </div>
        );
      })}

      {/* One button per column, over the shapes and the label. */}
      {items.map((item, index) => (
        <button
          key={`hit-${item.key}`}
          type="button"
          className="absolute top-0 cursor-pointer bg-transparent outline-none focus-visible:outline-[1.5px] focus-visible:outline-[var(--color-interaction)]"
          style={{ left: centerX(index) - pitch / 2, width: pitch, height: bracketY }}
          aria-label={`${item.label}: ${signedKg(item)} kg`}
          aria-pressed={pinnedKey === item.key}
          data-testid={`sankey-column-${item.key}`}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") onHover(item.key);
          }}
          onPointerLeave={() => onHover(null)}
          onFocus={() => onHover(item.key)}
          onBlur={() => onHover(null)}
          onClick={() => onSelect(item.key)}
        />
      ))}
    </div>
  );
}
