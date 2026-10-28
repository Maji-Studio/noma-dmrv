"use client";

/**
 * PROTOTYPE variant C, "Sankey restyled" (?variant=c). Keeps the flow ribbon,
 * because it shows how the stages connect, in the waterfall's language: the
 * big applied figure and its sentence at the left, the stage columns standing
 * on a quiet kg axis with an icon and label under each, every exit a hatched
 * drop rising off the ribbon with its value, the applied column lit, and one
 * caption line. Drawn 1:1 at the content width: no zoom canvas, no controls.
 * On a phone the same ribbon runs down the page and the drops turn right.
 */
import { useId } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { SankeyVariantProps } from "./variant-a-mass-waterfall";
import {
  exitPath,
  flowRect,
  layoutRibbon,
  linkLengthFor,
  type FlowPoint,
  type RibbonExit,
  type RibbonNode,
} from "./variant-c-geometry";
import {
  buildWaterfall,
  subtotalItems,
  type WaterfallItem,
  type WaterfallItemKey,
  type WaterfallModel,
} from "./waterfall-model";
import {
  DefaultCaption,
  HeadlineFigure,
  ItemDetail,
  ItemIcon,
  LIT_FILL,
  LIT_INK,
  MassWarnings,
  MINUS,
  kgNumber,
  ROWS_BELOW_PX,
  signedKg,
  STEP_STROKE,
  useColumnFocus,
  useMeasuredWidth,
  WATER_DASH,
} from "./waterfall-shared";

const EXIT_LINK: Partial<Record<WaterfallItemKey, number>> = {
  water_driven_off: 0,
  conversion_loss: 0,
  unallocated_output: 1,
  in_storage: 2,
};
/** A 16px bar needs a firmer fill than the waterfall's wide start column. */
const NODE_FILL = "var(--clr-dark-purple-40)";
const BAND_FILL = "var(--clr-dark-purple-10)";
const EXIT_UNDERLAY = "var(--clr-dark-purple-5)";
const DIM_OPACITY = 0.35;
/** The ribbon's drops are big, so their hatch is lighter and wider than the waterfall's. */
const RIBBON_HATCH_PX = 8;
const RIBBON_HATCH_STROKE = "var(--clr-dark-purple-30)";
const TICK_TARGET = 4;

/* Desktop */
const AXIS_W = 56;
const PAD_R = 56;
const BAR_T = 16;
const PLOT_H = 280;
const RISE = 28;
const EXIT_LABEL_H = 40;
const EXIT_LABEL_W = 120;
const DROP_GAP = 16;
const LABEL_BLOCK_H = 84;
const COLUMN_HIT_W = 64;

/* Phone */
const PHONE_BAR_T = 12;
const PHONE_SPAN = 0.5;
const PHONE_GAP = 56;
const PHONE_NODE_LABEL_H = 44;

interface RibbonParts {
  nodes: RibbonNode[];
  exits: RibbonExit[];
  nodeItems: WaterfallItem[];
  byKey: Map<WaterfallItemKey, WaterfallItem>;
}

function ribbonParts(model: WaterfallModel, subtotals: WaterfallItem[]): RibbonParts {
  const start = model.items[0];
  const end = model.items[model.items.length - 1];
  const water = model.items.find((item) => item.key === "water_driven_off");
  const nodeItems = [start, ...subtotals, end];
  const steps = model.items.filter((item) => item.kind === "step");
  return {
    nodes: nodeItems.map((item) => ({
      key: item.key,
      massKg: item.massKg,
      waterKg: item === start ? water?.massKg : undefined,
    })),
    exits: steps.map((item) => ({ key: item.key, massKg: item.massKg, link: EXIT_LINK[item.key] ?? 0 })),
    nodeItems,
    byKey: new Map([...model.items, ...subtotals].map((item) => [item.key, item])),
  };
}

function niceStep(max: number): number {
  if (max <= 0) return 1;
  const raw = max / TICK_TARGET;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

function nodeFill(item: WaterfallItem): string {
  return item.kind === "end" ? LIT_FILL : NODE_FILL;
}

interface RibbonProps {
  parts: RibbonParts;
  width: number;
  activeKey: WaterfallItemKey | null;
  pinnedKey: WaterfallItemKey | null;
  onHover: (key: WaterfallItemKey | null) => void;
  onSelect: (key: WaterfallItemKey) => void;
}

/** Shapes shared by both orientations: bands, node bars, hatched exits. */
function RibbonShapes({
  parts,
  layout,
  map,
  barT,
  activeKey,
}: {
  parts: RibbonParts;
  layout: ReturnType<typeof layoutRibbon>;
  map: FlowPoint;
  barT: number;
  activeKey: WaterfallItemKey | null;
}) {
  const hatchId = `rb-hatch-${useId().replace(/:/g, "")}`;
  const dim = (key: WaterfallItemKey) => (activeKey != null && activeKey !== key ? DIM_OPACITY : 1);
  return (
    <>
      <defs>
        <pattern id={hatchId} width={RIBBON_HATCH_PX} height={RIBBON_HATCH_PX} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={RIBBON_HATCH_PX} stroke={RIBBON_HATCH_STROKE} strokeWidth="1" />
        </pattern>
      </defs>
      {layout.bands.map((band, index) => {
        const rect = flowRect(map, band.u0, band.u1, 0, band.v);
        return <rect key={`band-${index}`} {...rect} fill={BAND_FILL} opacity={activeKey ? DIM_OPACITY + 0.2 : 1} />;
      })}
      {layout.exits.map((exit) => {
        const key = exit.key as WaterfallItemKey;
        const d = exitPath(exit, map);
        return (
          <g key={exit.key} opacity={dim(key)}>
            <path d={d} fill={EXIT_UNDERLAY} />
            <path
              d={d}
              fill={`url(#${hatchId})`}
              stroke={activeKey === key ? "var(--clr-dark-purple-100)" : STEP_STROKE}
              strokeWidth={1}
              strokeDasharray={key === "water_driven_off" ? WATER_DASH : undefined}
            />
          </g>
        );
      })}
      {layout.nodes.map((node, index) => {
        const item = parts.nodeItems[index];
        const dryV = node.v - node.waterV;
        const solid = flowRect(map, node.u, node.u + barT, 0, Math.max(1, dryV));
        const water = node.waterV > 0 ? flowRect(map, node.u, node.u + barT, dryV, node.v) : null;
        return (
          <g key={node.key} opacity={item.kind === "end" ? 1 : dim(item.key)}>
            <rect
              {...solid}
              fill={nodeFill(item)}
              stroke={activeKey === item.key ? "var(--clr-dark-purple-100)" : "none"}
              strokeWidth={1.25}
            />
            {water ? (
              <rect {...water} fill={`url(#${hatchId})`} stroke={STEP_STROKE} strokeWidth={1.25} strokeDasharray={WATER_DASH} />
            ) : null}
          </g>
        );
      })}
    </>
  );
}

function DesktopRibbon({ parts, width, activeKey, pinnedKey, onHover, onSelect }: RibbonProps) {
  const startKg = parts.nodes[0]?.massKg ?? 0;
  const step = niceStep(startKg);
  const axisMax = Math.max(step, Math.ceil(startKg / step) * step);
  const ticks = Array.from({ length: Math.round(axisMax / step) + 1 }, (_, index) => index * step);
  const scale = PLOT_H / axisMax;
  const vEnd = startKg * scale + RISE;
  const base = Math.max(PLOT_H + 12, vEnd + EXIT_LABEL_H + 8);
  const height = base + LABEL_BLOCK_H;
  const pitch = (width - AXIS_W - PAD_R - parts.nodes.length * BAR_T) / Math.max(1, parts.nodes.length - 1);
  const nodeU = parts.nodes.map((_, index) => AXIS_W + index * (BAR_T + pitch));
  const layout = layoutRibbon({ nodes: parts.nodes, exits: parts.exits, scale, barT: BAR_T, nodeU, gap: DROP_GAP, vEnd, fitDrops: true });
  const map: FlowPoint = (u, v) => [u, base - v];

  // Exit labels sit over their drops; push apart the ones that would touch.
  // Exit labels sit over their drops; push apart the ones that would touch.
  const exitLabels = layout.exits.reduce<{ exit: (typeof layout.exits)[number]; drop: number; center: number }[]>((placed, exit) => {
    const drop = exit.ud + exit.w / 2;
    const previous = placed[placed.length - 1];
    const minCenter = previous ? previous.center + EXIT_LABEL_W + 8 : -Infinity;
    placed.push({ exit, drop, center: Math.min(width - EXIT_LABEL_W / 2, Math.max(drop, minCenter)) });
    return placed;
  }, []);

  return (
    <div className="relative" style={{ width, height }} data-testid="sankey-ribbon">
      <svg width={width} height={height} aria-hidden className="absolute inset-0 overflow-visible">
        <text x={0} y={base - PLOT_H - 16} className="fill-[var(--color-text-tertiary)] font-mono text-[10px] uppercase tracking-[0.08em]">kg</text>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={AXIS_W - 8}
              x2={width}
              y1={base - tick * scale}
              y2={base - tick * scale}
              stroke={tick === 0 ? "var(--clr-dark-purple-40)" : "var(--clr-dark-purple-10)"}
              strokeWidth={1}
            />
            {tick > 0 ? (
              <text x={AXIS_W - 14} y={base - tick * scale + 4} textAnchor="end" className="fill-[var(--color-text-tertiary)] font-mono text-[10px] tabular-nums">
                {tick.toLocaleString()}
              </text>
            ) : null}
          </g>
        ))}
        <RibbonShapes parts={parts} layout={layout} map={map} barT={BAR_T} activeKey={activeKey} />
        {exitLabels.map(({ exit, drop, center }) =>
          Math.abs(center - drop) > 4 ? (
            <line
              key={`leader-${exit.key}`}
              x1={drop}
              x2={center}
              y1={base - vEnd}
              y2={base - vEnd - 6}
              stroke="var(--clr-dark-purple-40)"
              strokeDasharray="1 3"
            />
          ) : null,
        )}
      </svg>

      {exitLabels.map(({ exit, center }) => {
        const item = parts.byKey.get(exit.key as WaterfallItemKey);
        if (!item) return null;
        const active = activeKey === item.key;
        return (
          <button
            key={`exit-${exit.key}`}
            type="button"
            className="absolute flex cursor-pointer flex-col items-center justify-end bg-transparent text-center outline-none focus-visible:outline-[1.5px] focus-visible:outline-[var(--color-interaction)]"
            style={{ left: center - EXIT_LABEL_W / 2, width: EXIT_LABEL_W, top: base - vEnd - EXIT_LABEL_H - 8, height: EXIT_LABEL_H + 8 + RISE }}
            aria-label={`${item.label}: ${signedKg(item)} kg`}
            aria-pressed={pinnedKey === item.key}
            data-testid={`sankey-column-${item.key}`}
            onPointerEnter={(event) => event.pointerType === "mouse" && onHover(item.key)}
            onPointerLeave={() => onHover(null)}
            onFocus={() => onHover(item.key)}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(item.key)}
          >
            <span className="flex flex-col items-center" style={{ marginBottom: RISE + 6 }}>
              <span className={cn("body-caption leading-[16px]", active || pinnedKey === item.key ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]")}>
                {item.label}
              </span>
              <span className="body-small tabular-nums text-[var(--color-text-secondary)]">{MINUS}{kgNumber(item.massKg)} kg</span>
            </span>
          </button>
        );
      })}

      {layout.nodes.map((node, index) => {
        const item = parts.nodeItems[index];
        const lit = item.kind === "end";
        const center = node.u + BAR_T / 2;
        const labelW = Math.min(pitch, 140);
        return (
          <div key={`label-${node.key}`}>
            <div
              className="pointer-events-none absolute flex flex-col items-center gap-2 text-center"
              style={{ left: center - labelW / 2, width: labelW, top: base + 10 }}
            >
              <ItemIcon item={item} size={20} />
              <span
                className={cn("body-caption leading-[16px]", pinnedKey === item.key && "font-medium")}
                style={{ color: lit ? LIT_INK : activeKey === item.key ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}
              >
                {item.label}
              </span>
              <span
                className={cn("tabular-nums font-light", item.kind === "subtotal" ? "text-[14px]" : "text-[18px]")}
                style={{ color: lit ? LIT_INK : "var(--color-text-primary)" }}
              >
                {kgNumber(item.massKg)}
                {item.kind === "start" ? <span className="body-caption text-[var(--color-text-tertiary)]"> {item.basis}</span> : null}
              </span>
            </div>
            <button
              type="button"
              className="absolute cursor-pointer bg-transparent outline-none focus-visible:outline-[1.5px] focus-visible:outline-[var(--color-interaction)]"
              style={{ left: center - COLUMN_HIT_W / 2, width: COLUMN_HIT_W, top: base - node.v - 8, height: node.v + 8 + LABEL_BLOCK_H }}
              aria-label={`${item.label}: ${kgNumber(item.massKg)} kg`}
              aria-pressed={pinnedKey === item.key}
              data-testid={`sankey-column-${item.key}`}
              onPointerEnter={(event) => event.pointerType === "mouse" && onHover(item.key)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(item.key)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(item.key)}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Phone: the ribbon runs down the page; drops turn right with their label under them. */
function PhoneRibbon({ parts, width, activeKey, pinnedKey, onSelect }: RibbonProps) {
  const startKg = parts.nodes[0]?.massKg ?? 0;
  const scale = startKg > 0 ? (width * PHONE_SPAN) / startKg : 0;
  const nodeU: number[] = [];
  let u = PHONE_NODE_LABEL_H;
  parts.nodes.forEach((_, index) => {
    nodeU.push(u);
    const kgs = parts.exits.filter((exit) => exit.link === index).map((exit) => exit.massKg);
    u += PHONE_BAR_T + linkLengthFor(kgs, scale, PHONE_GAP, PHONE_NODE_LABEL_H);
  });
  const height = (nodeU[nodeU.length - 1] ?? 0) + PHONE_BAR_T + 8;
  const layout = layoutRibbon({ nodes: parts.nodes, exits: parts.exits, scale, barT: PHONE_BAR_T, nodeU, gap: PHONE_GAP, vEnd: width, fitDrops: false });
  const map: FlowPoint = (along, across) => [across, along];

  return (
    <div className="relative" style={{ width, height }} data-testid="sankey-ribbon">
      <svg width={width} height={height} aria-hidden className="absolute inset-0">
        <RibbonShapes parts={parts} layout={layout} map={map} barT={PHONE_BAR_T} activeKey={activeKey} />
      </svg>
      {layout.nodes.map((node, index) => {
        const item = parts.nodeItems[index];
        const lit = item.kind === "end";
        return (
          <button
            key={`node-${node.key}`}
            type="button"
            className={cn(
              "body-small absolute left-0 flex items-center gap-8 text-left",
              pinnedKey === item.key && "font-medium",
            )}
            style={{ top: node.u - PHONE_NODE_LABEL_H, height: PHONE_NODE_LABEL_H, width, color: lit ? LIT_INK : "var(--color-text-primary)" }}
            aria-pressed={pinnedKey === item.key}
            data-testid={`sankey-row-${item.key}`}
            onClick={() => onSelect(item.key)}
          >
            <ItemIcon item={item} size={18} className="shrink-0" />
            <span className="truncate">{item.label}</span>
            <span className="ml-auto whitespace-nowrap pr-8 tabular-nums">{kgNumber(item.massKg)} kg</span>
          </button>
        );
      })}
      {layout.exits.map((exit) => {
        const item = parts.byKey.get(exit.key as WaterfallItemKey);
        if (!item) return null;
        return (
          <button
            key={`exit-${exit.key}`}
            type="button"
            className={cn("absolute right-0 flex min-h-44 flex-col items-end justify-start text-right", pinnedKey === item.key && "font-medium")}
            style={{ top: exit.ud + exit.w + 2, width: width * 0.46 }}
            aria-pressed={pinnedKey === item.key}
            data-testid={`sankey-row-${item.key}`}
            onClick={() => onSelect(item.key)}
          >
            <span className="body-caption text-[var(--color-text-primary)]">{item.label}</span>
            <span className="body-caption tabular-nums text-[var(--color-text-secondary)]">{MINUS}{kgNumber(item.massKg)} kg</span>
          </button>
        );
      })}
    </div>
  );
}

export function VariantCSankeyRestyled({ sankey, lineages, batchCode }: SankeyVariantProps) {
  const facilityId = useSearchParams().get("facility");
  const model = buildWaterfall(sankey, lineages);
  const parts = ribbonParts(model, subtotalItems(sankey));
  const focus = useColumnFocus();
  const [width, measure] = useMeasuredWidth();
  const [chartWidth, measureChart] = useMeasuredWidth();
  const rows = width < ROWS_BELOW_PX;
  const activeItem = focus.active ? parts.byKey.get(focus.active) ?? null : null;
  const pinnedItem = focus.pinned ? parts.byKey.get(focus.pinned) ?? null : null;

  return (
    <div className="h-full overflow-auto bg-[var(--color-background-white)]" data-testid="batch-sankey" aria-label={`Mass balance for credit batch ${batchCode}`}>
      <div ref={measure} className="container-max flex flex-col gap-24 pb-96 pt-32">
        {rows ? (
          <>
            <HeadlineFigure model={model} compact />
            <div ref={measureChart}>
              <PhoneRibbon parts={parts} width={chartWidth} activeKey={focus.pinned} pinnedKey={focus.pinned} onHover={focus.hover} onSelect={focus.toggle} />
            </div>
            {/* A pinned detail sticks to the bottom (padded clear of the variant pill), so a tap low on the ribbon still shows it. */}
            <div
              className={cn(
                "border-t border-[var(--clr-dark-purple-10)] bg-[var(--color-background-white)] py-12",
                pinnedItem && "sticky bottom-0 pb-72",
              )}
              aria-live="polite"
            >
              {pinnedItem ? (
                <div className="flex flex-col gap-4">
                  <p className="body-small font-medium text-[var(--color-text-primary)]">
                    {pinnedItem.label} {signedKg(pinnedItem)} kg
                  </p>
                  <ItemDetail item={pinnedItem} facilityId={facilityId} layout="stack" />
                </div>
              ) : (
                <DefaultCaption rows ribbon />
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,9fr)] items-end gap-48">
              <div className="pb-128">
                <HeadlineFigure model={model} />
              </div>
              <div ref={measureChart} className="min-w-0">
                <DesktopRibbon parts={parts} width={chartWidth} activeKey={focus.active} pinnedKey={focus.pinned} onHover={focus.hover} onSelect={focus.toggle} />
              </div>
            </div>
            <div className="flex min-h-64 items-center border-t border-[var(--clr-dark-purple-10)] pt-12" aria-live="polite">
              {activeItem ? <ItemDetail item={activeItem} facilityId={facilityId} /> : <DefaultCaption ribbon />}
            </div>
          </>
        )}
        <MassWarnings warnings={model.warnings} />
      </div>
    </div>
  );
}
