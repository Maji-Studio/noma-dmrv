/**
 * Details shared by split bays, pile bands, chart steps and the draw picker.
 */
"use client";

import { Button } from "@/components/ui/button";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { cloneElement, useState, type MouseEvent, type ReactElement } from "react";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type { OutputSubBin, SubBinMovement } from "@/types/output-stock";
import { formatWetEstimate } from "./stock-preview-shared";

const MOVEMENT_LABELS: Record<SubBinMovement["kind"], string> = {
  added: "Added", removed: "Removed", loss: "Lost mass", count: "Stock count",
};

const TOOLTIP_OFFSET_PX = 6;
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

/**
 * Dark details opened from `trigger`: on hover and focus like every tooltip,
 * and on tap, since a touch screen has neither. Labels sit dimmed on the
 * left so the values lead.
 */
export function DetailsTooltip({ title, rows, groups = [], trigger }: {
  title: string;
  rows: { label: string; value: string }[];
  /** Further aligned tables under the first, such as latest movements. */
  groups?: { label: string; rows: { label: string; value: string }[] }[];
  trigger: TapTrigger;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); setOpen(!open); };
  const table = (items: { label: string; value: string }[], label?: string) => (
    <dl aria-label={label} className="grid grid-cols-[auto_auto] gap-x-12 gap-y-2 [&_dt]:opacity-70">
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
              {groups.filter((group) => group.rows.length > 0).map((group) => <div key={group.label} className="mt-8">{table(group.rows, group.label)}</div>)}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}

/** A sub-bin's details: wet estimate, moisture, dry biochar, solids, time added and the last movements. */
export function SubBinTooltip({ subBin, timeZone, trigger }: { subBin: OutputSubBin; timeZone: string; trigger: TapTrigger }) {
  return (
    <DetailsTooltip title={subBin.code} trigger={trigger}
      rows={[
        { label: "Wet, estimated", value: subBinWetText(subBin) },
        { label: "Moisture", value: subBinMoistureText(subBin) },
        { label: "Dry biochar", value: formatMassKg(subBin.dryMassKg) },
        { label: "Solids", value: formatMassKg(subBin.solidsKg) },
        { label: "Added", value: formatFacilityDateTime(subBin.placedAt, timeZone) },
      ]}
      groups={[{ label: "Latest movements", rows: subBin.recentMovements.map((movement) => ({
        label: `${MOVEMENT_LABELS[movement.kind]} ${movementMass(movement)}`, value: formatFacilityDateTime(movement.occurredAt, timeZone),
      })) }]} />
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
