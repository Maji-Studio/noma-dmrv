"use client";

/**
 * PROTOTYPE (Sankey waterfall variants): the pieces variants A, B and C share.
 * Icons and accents come from the Flow chart's node styles so Flow, Map and
 * Sankey read as siblings.
 */
import { createElement, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { Icon } from "@phosphor-icons/react";
import {
  ArrowRightIcon,
  ArrowSquareOutIcon,
  CubeIcon,
  DropIcon,
  FactoryIcon,
  FlameIcon,
  LeafIcon,
  MapPinIcon,
  PackageIcon,
  WarehouseIcon,
} from "@phosphor-icons/react/dist/ssr";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { Notice } from "@/components/ui/notice";
import { formatMassKg } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { LINEAGE_NODE_STYLES } from "../../chain-constants";
import { recordListHref } from "./record-href";
import {
  countWord,
  levelAfter,
  type WaterfallItem,
  type WaterfallItemKey,
  type WaterfallModel,
  type WaterfallStage,
} from "./waterfall-model";

/** Width drawn before the first measurement. */
const INITIAL_WIDTH_PX = 960;
/** Below this content width the chart turns into rows, like the product page on a phone. */
export const ROWS_BELOW_PX = 720;
export const MINUS = "−";

export const ITEM_ICONS: Record<WaterfallItemKey, Icon> = {
  feedstock: LeafIcon,
  water_driven_off: DropIcon,
  conversion_loss: FlameIcon,
  unallocated_output: ArrowSquareOutIcon,
  in_storage: WarehouseIcon,
  applied: MapPinIcon,
  productionRuns: FactoryIcon,
  biocharLots: CubeIcon,
};

/** "Not bagged into lots" reads better as a package than as an exit arrow. */
export function itemIcon(item: WaterfallItem): Icon {
  if (item.key === "unallocated_output" && item.label !== "Outside these applications") return PackageIcon;
  return ITEM_ICONS[item.key];
}

/** A column's icon, tinted in its records' accent (the lit one in the accent). */
export function ItemIcon({ item, size, className }: { item: WaterfallItem; size: number; className?: string }) {
  return createElement(itemIcon(item), {
    size,
    className,
    "aria-hidden": true,
    style: { color: item.kind === "end" ? LIT_INK : itemInk(item) },
  });
}

export const STAGE_ICONS: Record<WaterfallStage, Icon> = {
  productionRuns: FactoryIcon,
  biocharLots: CubeIcon,
};

/** Accent ink of the records behind a column, from the Flow chart. */
export function itemInk(item: WaterfallItem): string {
  return LINEAGE_NODE_STYLES[item.recordKind].accentInk;
}

export const LIT_FILL = "var(--acc-dist)";
export const LIT_INK = "var(--acc-dist-ink)";
export const START_FILL = "var(--clr-dark-purple-5)";
export const START_STROKE = "var(--clr-dark-purple-40)";
export const STEP_STROKE = "var(--clr-dark-purple-60)";
export const HATCH_STROKE = "var(--clr-dark-purple-40)";
/** Water is dashed, the way the product page dashes transport. */
export const WATER_DASH = "4 3";

/** The hatch as CSS, for HTML bars. */
export const HATCH_BACKGROUND: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--clr-dark-purple-40) 0 1px, transparent 1px 5px)",
};

/** Number part of a mass ("1,563.5"), for figures that set the unit apart. */
export function kgNumber(kg: number): string {
  return formatMassKg(kg).replace(/\s*kg$/, "");
}

export function signedKg(item: WaterfallItem): string {
  return item.kind === "step" ? `${MINUS}${kgNumber(item.massKg)}` : kgNumber(item.massKg);
}

export function recordCountLabel(item: WaterfallItem): string {
  const count = item.count ?? item.records.length;
  const style = LINEAGE_NODE_STYLES[item.recordKind];
  return `${count} ${count === 1 ? style.label.toLowerCase() : style.plural}`;
}

/** Track the element's content width. Keeps the last width while it is hidden. */
export function useMeasuredWidth(): [number, (element: HTMLDivElement | null) => (() => void) | undefined] {
  const [width, setWidth] = useState(INITIAL_WIDTH_PX);
  const measure = (element: HTMLDivElement | null) => {
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  };
  return [width, measure];
}

/** Hover previews a column; a click or tap pins it. */
export function useColumnFocus(initial: WaterfallItemKey | null = null) {
  const [pinned, setPinned] = useState<WaterfallItemKey | null>(initial);
  const [hovered, setHovered] = useState<WaterfallItemKey | null>(null);
  return {
    active: hovered ?? pinned,
    pinned,
    hover: setHovered,
    toggle: (key: WaterfallItemKey) => setPinned((current) => (current === key ? initial : key)),
    pin: setPinned,
  };
}

/** Plain sentence of how the figure is made, like "620 kg stored, less 137 kg ...". */
export function summarySentence(model: WaterfallModel): string {
  const start = formatMassKg(model.startKg);
  const went = model.startBasis === "wet" ? `${start} of wet feedstock went in.` : `${start} of dry feedstock went in.`;
  const steps = model.stepCount === 1 ? "One step took out" : `${capitalise(countWord(model.stepCount))} steps took out`;
  return model.stepCount === 0 ? went : `${went} ${steps} ${formatMassKg(model.removedKg)}.`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The (i) beside the sentence: the running ledger the chart draws. */
export function LedgerExplanation({ model }: { model: WaterfallModel }) {
  return (
    <ExplanationInfo
      title="How this figure is made"
      hint={
        model.startBasis === "wet"
          ? "The feedstock is weighed wet. Water driven off is that wet mass less the dry feedstock the runs recorded, so every figure after it is dry."
          : "The runs' draws have no wet mass, so the chart starts from the dry feedstock the runs recorded."
      }
    >
      <table className="w-full body-caption">
        <tbody>
          {model.items.map((item) => (
            <tr key={item.key} className="border-t border-[var(--clr-dark-purple-10)]">
              <td className="py-4 pr-8 text-[var(--color-text-secondary)]">{item.label}</td>
              <td className="py-4 pr-8 text-right tabular-nums whitespace-nowrap">{signedKg(item)} kg</td>
              <td className="py-4 text-right tabular-nums whitespace-nowrap text-[var(--color-text-tertiary)]">
                {item.kind === "step" ? `${kgNumber(levelAfter(item))} kg left` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.appliedWetKg != null ? (
        <p className="body-caption text-[var(--color-text-secondary)]">
          The applications weighed {formatMassKg(model.appliedWetKg)} of product, wet, with its ingredients and water. The chart follows the dry biochar in it.
        </p>
      ) : null}
    </ExplanationInfo>
  );
}

/** Big figure at the left: the lit column's mass, its unit, and how it is made. */
export function HeadlineFigure({ model, compact = false }: { model: WaterfallModel; compact?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col" data-testid="sankey-headline">
      {/* Divs, not <p>: the global p rule would beat the size utilities. */}
      <div
        className={cn(
          "font-light tabular-nums tracking-[-0.02em] text-[var(--color-text-primary)]",
          compact ? "text-[48px]" : "text-[72px]",
        )}
        style={{ lineHeight: 1.05 }}
      >
        {kgNumber(model.endKg)}
      </div>
      <div className={cn("mt-8 text-[var(--color-text-primary)]", compact ? "body-medium" : "body-large")}>
        kg dry biochar applied
      </div>
      <p className="body-small mt-16 border-t border-[var(--clr-dark-purple-10)] pt-12 text-[var(--color-text-secondary)]">
        {summarySentence(model)} <LedgerExplanation model={model} />
      </p>
    </div>
  );
}

/** One caption line under the chart. */
export function DefaultCaption({ rows = false, ribbon = false }: { rows?: boolean; ribbon?: boolean }) {
  const target = rows ? "row" : "column";
  const lead = ribbon
    ? "The ribbon is the mass moving from stage to stage. Each hatched drop is mass that left the chain. The lit column is what was applied."
    : rows
      ? "The first bar is the feedstock that went in. Each step back is mass that left the chain. The lit bar is what was applied."
      : "The first column is the feedstock that went in. Each step down is mass that left the chain. The lit column is what was applied.";
  return (
    <p className="body-small text-[var(--color-text-secondary)]">
      {lead} <span className="text-[var(--color-text-tertiary)]">Hover or tap a {ribbon && rows ? "label" : target} for details.</span>
    </p>
  );
}

/** What a column is, its records and the link to them. */
export function ItemDetail({
  item,
  facilityId,
  layout = "row",
}: {
  item: WaterfallItem;
  facilityId: string | null;
  /** "row": the caption row under a desktop chart. "stack": under a phone row, which already names the column. */
  layout?: "row" | "stack";
}) {
  const lit = item.kind === "end";
  const records = (
    <span className="body-small inline-flex flex-wrap items-center gap-x-12 text-[var(--color-text-tertiary)]">
      {recordCountLabel(item)}
      <Link
        href={recordListHref(item.recordKind, facilityId)}
        className="inline-flex min-h-44 items-center gap-6 font-medium text-[var(--clr-dark-purple)] underline-offset-4 hover:underline"
        data-testid="sankey-detail-link"
      >
        See details
        <ArrowRightIcon size={14} weight="bold" aria-hidden />
      </Link>
    </span>
  );
  if (layout === "stack") {
    return (
      <div className="flex flex-col" data-testid="sankey-detail">
        <p className="body-small text-[var(--color-text-secondary)]">{item.note}</p>
        {records}
      </div>
    );
  }
  return (
    <div
      className="grid w-full grid-cols-[minmax(0,3fr)_minmax(0,5fr)_auto_auto] items-center gap-x-24"
      data-testid="sankey-detail"
    >
      <p className="body-medium flex items-center gap-8 font-medium text-[var(--color-text-primary)]">
        <ItemIcon item={item} size={18} className="shrink-0" />
        {item.label}
      </p>
      <p className="body-small text-[var(--color-text-secondary)]">{item.note}</p>
      {records}
      <p
        className="body-medium whitespace-nowrap text-right tabular-nums"
        style={{ color: lit ? LIT_INK : "var(--color-text-primary)" }}
      >
        {signedKg(item)} kg{item.kind === "start" ? ` ${item.basis}` : ""}
      </p>
    </div>
  );
}

/** Mass-balance inconsistencies the lib clamped, said once. */
export function MassWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <Notice tone="warning" title="Mass balance inconsistencies">
      {warnings.join(" ")}
    </Notice>
  );
}
