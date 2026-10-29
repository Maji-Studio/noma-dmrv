"use client";

/**
 * The pieces the Sankey waterfall view is built from.
 * Icons and accents come from the Flow chart's node styles so Flow, Map and
 * Sankey read as siblings.
 */
import { createElement, useState, type CSSProperties } from "react";
import type { Icon } from "@phosphor-icons/react";
import {
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
import { LINEAGE_NODE_STYLES } from "../chain-constants";
import {
  countWord,
  type DryStartReason,
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
/** Every exit but water is a plain box; hatching is reserved for water. */
export const STEP_FILL = "var(--clr-dark-purple-10)";
export const HATCH_STROKE = "var(--clr-dark-purple-40)";

/** The fill of a column: hatched for water, light for exits, the dry fill for biochar left in storage. */
export function stepFill(item: WaterfallItem): string {
  return item.key === "in_storage" ? START_FILL : STEP_FILL;
}

/** The water hatch as CSS, for HTML bars. */
export const HATCH_BACKGROUND: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--clr-dark-purple-40) 0 1px, transparent 1px 5px)",
};

/** Number part of a mass ("1,563.5"), for figures that set the unit apart. */
export function kgNumber(kg: number): string {
  return formatMassKg(kg).replace(/\s*kg$/, "");
}

export function signedKg(item: WaterfallItem): string {
  if (item.figureMissing) return formatMassKg(null);
  return item.kind === "step" ? `${MINUS}${kgNumber(item.massKg)}` : kgNumber(item.massKg);
}

/** The figure with its unit; the shared missing token stands alone. */
export function valueLabel(item: WaterfallItem): string {
  return item.figureMissing ? formatMassKg(null) : `${signedKg(item)} kg`;
}

export function recordCountLabel(item: WaterfallItem): string {
  const count = item.records.length;
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
  const went =
    model.dryStartReason === "dry-input-missing"
      ? "Dry feedstock is not recorded on every run."
      : model.startBasis === "wet"
        ? `${start} of wet feedstock went in.`
        : `${start} of dry feedstock went in.`;
  if (!model.balanced) return went;
  const steps = model.stepCount === 1 ? "One step took out" : `${capitalise(countWord(model.stepCount))} steps took out`;
  return model.stepCount === 0 ? went : `${went} ${steps} ${formatMassKg(model.removedKg)}.`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const DRY_START_HINTS: Record<DryStartReason, string> = {
  "wet-missing": "Some draws have no wet mass, so the chart starts from the dry feedstock the runs recorded.",
  "dry-input-missing": "Some runs have no dry feedstock recorded, so the chart starts from the dry feedstock that is recorded.",
  "wet-below-dry": "The wet mass recorded is below the dry mass, so the chart starts from the dry feedstock the runs recorded.",
};

/** The (i) beside the sentence: the running ledger the chart draws. */
export function LedgerExplanation({ model }: { model: WaterfallModel }) {
  return (
    <ExplanationInfo
      title="How this figure is made"
      hint={
        model.startBasis === "wet"
          ? "The feedstock is weighed wet. Water driven off is that wet mass less the dry feedstock the runs recorded, so every figure after it is dry."
          : DRY_START_HINTS[model.dryStartReason ?? "wet-missing"]
      }
    >
      <table className="w-full body-caption">
        <tbody>
          {model.items.map((item) => (
            <tr key={item.key} className="border-t border-[var(--clr-dark-purple-10)]">
              <td className="py-4 pr-8 text-[var(--color-text-secondary)]">{item.label}</td>
              <td className="py-4 pr-8 text-right tabular-nums whitespace-nowrap">{valueLabel(item)}</td>
              <td className="py-4 text-right tabular-nums whitespace-nowrap text-[var(--color-text-tertiary)]">
                {item.kind === "step" && model.balanced ? `${kgNumber(levelAfter(item))} kg left` : ""}
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
export function HeadlineFigure({ model }: { model: WaterfallModel }) {
  return (
    <div className="flex min-w-0 flex-col" data-testid="sankey-headline">
      {/* Divs, not <p>: the global p rule would beat the size utilities. */}
      <div
        className="text-[48px] font-light tabular-nums tracking-[-0.02em] text-[var(--color-text-primary)]"
        style={{ lineHeight: 1.05 }}
      >
        {kgNumber(model.endKg)}
      </div>
      {/* Margins sit on wrappers: the global type classes beat margin utilities. */}
      <div className="mt-8">
        <div className="body-medium text-[var(--color-text-primary)]">kg dry biochar applied</div>
      </div>
      <div className="mt-16 border-t border-[var(--clr-dark-purple-10)] pt-12">
        <p className="body-small text-[var(--color-text-secondary)]">
          {summarySentence(model)} <LedgerExplanation model={model} />
        </p>
      </div>
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

/** The steps cannot close on the applied column: say so, and name the records to check. */
export function UnbalancedNotice({ warnings }: { warnings: readonly string[] }) {
  return (
    <Notice tone="warning" title="These records do not balance">
      Each column is drawn from zero, not stepped down from the one before. Check the masses on the records.
      {warnings.length > 0 ? ` ${warnings.join(" ")}` : ""}
    </Notice>
  );
}
