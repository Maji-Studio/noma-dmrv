/**
 * Details shared by split bays, pile bands, chart steps and the draw picker.
 */
"use client";

import { Button } from "@/components/ui/button";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { cloneElement, useState, type MouseEvent, type ReactElement } from "react";
import { NO_MOISTURE_READING } from "@/lib/copy-utils";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { DRY_BIOCHAR_LABEL, ingredientSolidsLabel } from "@/components/biochar-products/product-composition-components";
import { ESTIMATED_WATER_LABEL, ESTIMATED_WET_LABEL, INGREDIENT_SOLIDS_LABEL } from "@/lib/output-stock/labels";
import { stockParts, subBinFigures, type StockPart } from "@/lib/output-stock/stock-parts";
import type { OutputSubBin, SubBinMovement } from "@/types/output-stock";
import { formatPartFigures } from "./output-stock-history-days";
import { formatWetEstimate, outputStockFigure } from "./stock-preview-shared";

const MOVEMENT_LABELS: Record<SubBinMovement["kind"], string> = {
  added: "Added", removed: "Removed", loss: "Lost mass", count: "Stock count",
};

const TOOLTIP_OFFSET_PX = 6;
const CONTENTS_LABEL = "Contents";
const MOVEMENTS_LABEL = "Latest movements";
/** The shared tooltip's delays (`components/ui/tooltip`). */
const OPEN_DELAY_MS = 160;
const CLOSE_DELAY_MS = 80;

/** The sub-bin's wet stock; with no wet figure, its known dry biochar, never a placeholder (#1261). */
export function subBinWetText(subBin: OutputSubBin): string {
  return outputStockFigure(subBin.wetEstimateKg, subBin.dryMassKg);
}

/** The sub-bin's estimated moisture, or why there is none. */
export function subBinMoistureText(subBin: OutputSubBin): string {
  return subBin.moisturePercent === null ? NO_MOISTURE_READING : formatMoisturePercent(subBin.moisturePercent);
}

/** A sub-bin's moisture as a caption: "26.7% moisture", or why there is no reading. */
export function subBinMoistureCaption(subBin: OutputSubBin): string {
  return subBin.moisturePercent === null ? NO_MOISTURE_READING : `${subBinMoistureText(subBin)} moisture`;
}

export function movementMass(movement: SubBinMovement): string {
  return movement.wetMassKg === null ? outputStockFigure(null, Math.abs(movement.dryMassKg)) : `${formatMassKg(Math.abs(movement.wetMassKg))} wet mass`;
}

type TapTrigger = ReactElement<{ onClick?: (event: MouseEvent) => void }>;

export interface DetailRow { label: string; value: string }

/** A stock part named the way the product composition names it. */
export function partLabel(part: StockPart): string {
  if (part.kind === "ingredient") return part.name === null ? INGREDIENT_SOLIDS_LABEL : ingredientSolidsLabel(part.name);
  return part.kind === "water" ? ESTIMATED_WATER_LABEL : DRY_BIOCHAR_LABEL;
}

/** A part's kg: water is an estimate and reads like the wet mass it is part of, other parts keep their decimal. */
export function partFigure(part: StockPart): string {
  return formatPartFigures({ label: partLabel(part), changeKg: null, afterKg: part.kg, estimated: part.kind === "water" }).after;
}

/**
 * What a sub-bin or batch is made of, as the product composition names the
 * parts, top down in the order the bay draws them (`stockParts`): water, each
 * ingredient's solids, then dry biochar. A batch with no wet estimate has no
 * water row: there is nothing to subtract.
 */
export function partRows(parts: readonly StockPart[]): DetailRow[] {
  return parts.map((part) => ({ label: partLabel(part), value: partFigure(part) }));
}

/** A sub-bin's contents rows as its tooltip lists them. */
export function subBinContentsRows(subBin: OutputSubBin): DetailRow[] {
  return partRows(stockParts(subBinFigures(subBin)).rows);
}

/**
 * Dark details opened from `trigger`: on hover and focus like every tooltip,
 * and on tap, since a touch screen has neither. Labels sit dimmed on the
 * left so the values lead, and every table spans the popup so their figures
 * share one right edge. A group's name heads it, dimmed like the labels.
 */
export function DetailsTooltip({ title, rows, groups = [], trigger }: {
  title: string;
  rows: DetailRow[];
  /** Further aligned tables under the first, such as latest movements. */
  groups?: { label: string; rows: DetailRow[] }[];
  trigger: TapTrigger;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); setOpen(!open); };
  const table = (items: DetailRow[], label?: string) => (
    <dl aria-label={label} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-2 [&_dt]:opacity-70">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="contents">
          <dt className="tabular-nums">{item.label}</dt><dd className="tabular-nums text-right">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <BaseTooltip.Provider delay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>
      {/* A press is the tap toggle below; the tooltip's own press-to-close would undo it at once. */}
      <BaseTooltip.Root open={open} onOpenChange={(next, details) => { if (details.reason !== "trigger-press") setOpen(next); }}>
        <BaseTooltip.Trigger render={cloneElement(trigger, { onClick: toggle })} />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner side="top" sideOffset={TOOLTIP_OFFSET_PX} className="z-[var(--z-layer-popover)]">
            <BaseTooltip.Popup className="max-w-[300px] px-12 py-8 bg-[var(--color-background-dark-strong)] text-[var(--color-background-white)] border border-[var(--color-border-primary)] body-caption">
              <span className="mb-4 block font-medium">{title}</span>
              {table(rows)}
              {groups.filter((group) => group.rows.length > 0).map((group) => <div key={group.label} className="mt-8">
                <span aria-hidden="true" className="mb-2 block opacity-70">{group.label}</span>
                {table(group.rows, group.label)}
              </div>)}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}

/**
 * A sub-bin's details: its wet estimate and moisture, when it was added, what
 * it is made of and its last movements. Without a dated moisture there is no
 * wet estimate to show, so its rows give way to the dry contents.
 */
export function SubBinTooltip({ subBin, timeZone, trigger }: { subBin: OutputSubBin; timeZone: string; trigger: TapTrigger }) {
  const wet = subBin.wetEstimateKg === null ? [] : [
    // The label already says wet, so the value is the bare estimate.
    { label: ESTIMATED_WET_LABEL, value: `${formatWetEstimate(subBin.wetEstimateKg)} kg` },
    { label: "Moisture", value: subBinMoistureText(subBin) },
  ];
  return (
    <DetailsTooltip title={subBin.code} trigger={trigger}
      rows={[...wet, { label: "Added", value: formatFacilityDateTime(subBin.placedAt, timeZone) }]}
      groups={[
        { label: CONTENTS_LABEL, rows: subBinContentsRows(subBin) },
        { label: MOVEMENTS_LABEL, rows: subBin.recentMovements.map((movement) => ({
          label: formatFacilityDateTime(movement.occurredAt, timeZone), value: `${MOVEMENT_LABELS[movement.kind]} ${movementMass(movement)}`,
        })) },
      ]} />
  );
}

/** The ⓘ beside a sub-bin row, opening the same details as hovering a bay. */
export function SubBinInfo({ subBin, timeZone }: { subBin: OutputSubBin; timeZone: string }) {
  return (
    <SubBinTooltip subBin={subBin} timeZone={timeZone} trigger={
      <Button
        type="button" variant="noOutline" size="icon"
        aria-label={`${subBin.code} details`}
        className="inline-flex h-24 w-24 min-w-24 min-h-24 shrink-0 items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
      >
        <InfoIcon size={14} weight="bold" />
      </Button>
    } />
  );
}
