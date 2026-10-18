/**
 * Details shared by split bays, pile bands, chart steps and the draw picker.
 */
"use client";

import { Button } from "@/components/ui/button";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { cloneElement, useState, type MouseEvent, type ReactElement } from "react";
import { STOCK_PART_MIN_KG } from "@/config/output-stock";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { DRY_BIOCHAR_LABEL, ingredientSolidsLabel } from "@/components/biochar-products/product-composition-components";
import { ESTIMATED_WATER_LABEL, ESTIMATED_WET_LABEL } from "@/lib/output-stock/labels";
import type { OutputSubBin, SubBinMovement } from "@/types/output-stock";
import { formatWetEstimate } from "./stock-preview-shared";

const MOVEMENT_LABELS: Record<SubBinMovement["kind"], string> = {
  added: "Added", removed: "Removed", loss: "Lost mass", count: "Stock count",
};

const TOOLTIP_OFFSET_PX = 6;
const CONTENTS_LABEL = "Contents";
const MOVEMENTS_LABEL = "Latest movements";
/** The shared tooltip's delays (`components/ui/tooltip`). */
const OPEN_DELAY_MS = 160;
const CLOSE_DELAY_MS = 80;

/** The sub-bin's wet stock, or the missing-value token when nothing dates its moisture. */
export function subBinWetText(subBin: OutputSubBin): string {
  return subBin.wetEstimateKg === null ? MISSING_VALUE.notAvailable : `≈ ${formatWetEstimate(subBin.wetEstimateKg)} kg wet`;
}

/** The sub-bin's estimated moisture, or the same missing-value token as its wet figure. */
export function subBinMoistureText(subBin: OutputSubBin): string {
  return subBin.moisturePercent === null ? MISSING_VALUE.notAvailable : formatMoisturePercent(subBin.moisturePercent);
}

function movementMass(movement: SubBinMovement): string {
  return movement.wetMassKg === null ? `${formatMassKg(Math.abs(movement.dryMassKg))} dry` : `${formatMassKg(Math.abs(movement.wetMassKg))} wet`;
}

type TapTrigger = ReactElement<{ onClick?: (event: MouseEvent) => void }>;

export interface DetailRow { label: string; value: string }

/**
 * What a sub-bin or batch is made of, as the product composition names the
 * parts, top down in the order the bay draws them: the water its wet estimate
 * holds over its solids, each ingredient's solids, then its dry biochar. Pure
 * biochar has no ingredient row, and a batch with no wet estimate has no water
 * row: there is nothing to subtract.
 */
export function contentsRows({ dryMassKg, ingredients, waterKg }: Pick<OutputSubBin, "dryMassKg" | "ingredients"> & { waterKg: number | null }): DetailRow[] {
  return [
    ...(waterKg !== null && waterKg >= STOCK_PART_MIN_KG ? [{ label: ESTIMATED_WATER_LABEL, value: formatMassKg(waterKg) }] : []),
    ...ingredients.filter((ingredient) => ingredient.solidsKg >= STOCK_PART_MIN_KG)
      .map((ingredient) => ({ label: ingredientSolidsLabel(ingredient.name), value: formatMassKg(ingredient.solidsKg) })),
    { label: DRY_BIOCHAR_LABEL, value: formatMassKg(dryMassKg) },
  ];
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
    { label: ESTIMATED_WET_LABEL, value: `≈ ${formatWetEstimate(subBin.wetEstimateKg)} kg` },
    { label: "Moisture", value: subBinMoistureText(subBin) },
  ];
  const waterKg = subBin.wetEstimateKg === null ? null : Math.max(subBin.wetEstimateKg - subBin.solidsKg, 0);
  return (
    <DetailsTooltip title={subBin.code} trigger={trigger}
      rows={[...wet, { label: "Added", value: formatFacilityDateTime(subBin.placedAt, timeZone) }]}
      groups={[
        { label: CONTENTS_LABEL, rows: contentsRows({ dryMassKg: subBin.dryMassKg, ingredients: subBin.ingredients, waterKg }) },
        { label: MOVEMENTS_LABEL, rows: subBin.recentMovements.map((movement) => ({
          label: `${MOVEMENT_LABELS[movement.kind]} ${movementMass(movement)}`, value: formatFacilityDateTime(movement.occurredAt, timeZone),
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
