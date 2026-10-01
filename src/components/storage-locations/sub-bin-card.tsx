/**
 * A split bin's sub-bins: one batch or production run each, kept physically
 * apart. Cards lead with what an operator reads off the heap, wet mass and
 * moisture; dry biochar, solids and the latest movements sit behind the ⓘ.
 * Past `SUB_BIN_CARD_LIMIT` sub-bins the cards become rows, so a long bin stays
 * scannable.
 */
"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { SUB_BIN_CARD_LIMIT } from "@/config/output-stock";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatFacilityDateTime, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type { OutputSubBin, SubBinMovement } from "@/types/output-stock";
import { formatWetEstimate } from "./stock-preview-shared";

const MOVEMENT_LABELS: Record<SubBinMovement["kind"], string> = {
  added: "Added", removed: "Removed", loss: "Loss reported", count: "Stock count",
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

/**
 * The ⓘ beside a sub-bin: dry biochar, solids, time added and the last
 * movements. Opens on hover and focus like every tooltip, and on tap, since a
 * touch screen has neither.
 */
export function SubBinInfo({ subBin, timeZone }: { subBin: OutputSubBin; timeZone: string }) {
  const [open, setOpen] = useState(false);
  return (
    <BaseTooltip.Provider delay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS}>
      {/* A press is the tap toggle below; the tooltip's own press-to-close would undo it at once. */}
      <BaseTooltip.Root open={open} onOpenChange={(next, details) => { if (details.reason !== "trigger-press") setOpen(next); }}>
        <BaseTooltip.Trigger
          render={
            <button
              type="button"
              aria-label={`${subBin.code} details`}
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(!open); }}
              className="inline-flex min-w-24 min-h-24 shrink-0 items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
            >
              <InfoIcon size={14} weight="bold" />
            </button>
          }
        />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner side="top" sideOffset={TOOLTIP_OFFSET_PX} className="z-[var(--z-layer-popover)]">
            <BaseTooltip.Popup className="max-w-[300px] px-12 py-8 bg-[var(--color-background-dark-strong)] text-[var(--color-background-white)] border border-[var(--color-border-primary)] shadow-[0_4px_16px_var(--color-black-10)] body-caption">
              {/* One aligned table: the sub-bin's figures, then its latest movements. */}
              <dl className="grid grid-cols-[auto_auto] gap-x-12 gap-y-2">
                <dt>Dry biochar</dt><dd className="tabular-nums text-right">{formatMassKg(subBin.dryMassKg)}</dd>
                <dt>Solids</dt><dd className="tabular-nums text-right">{formatMassKg(subBin.solidsKg)}</dd>
                <dt>Added</dt><dd className="tabular-nums text-right">{formatFacilityDateTime(subBin.placedAt, timeZone)}</dd>
              </dl>
              {subBin.recentMovements.length > 0 && (
                <dl className="mt-8 grid grid-cols-[auto_auto] gap-x-12 gap-y-2" aria-label="Latest movements">
                  {subBin.recentMovements.map((movement) => (
                    <div key={movement.id} className="contents">
                      <dt className="tabular-nums">{MOVEMENT_LABELS[movement.kind]} {movementMass(movement)}</dt>
                      <dd className="tabular-nums text-right">{formatFacilityDateTime(movement.occurredAt, timeZone)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}

/** One sub-bin, wet first: code, time added, wet estimate, estimated moisture. */
export function SubBinCard({ subBin, timeZone }: { subBin: OutputSubBin; timeZone: string }) {
  return (
    <li className="flex flex-col gap-4 bg-[var(--panel-bg)] [border:var(--panel-border)] px-12 py-10">
      <div className="flex items-center justify-between gap-8">
        <span className="body-small font-medium">{subBin.code}</span>
        <SubBinInfo subBin={subBin} timeZone={timeZone} />
      </div>
      <span className="body-caption text-[var(--color-text-tertiary)] tabular-nums">Added {formatFacilityDateTime(subBin.placedAt, timeZone)}</span>
      <span className="body-small tabular-nums">{subBinWetText(subBin)}</span>
      <span className="body-caption text-[var(--color-text-secondary)] tabular-nums">Estimated moisture {subBinMoistureText(subBin)}</span>
    </li>
  );
}

/** One sub-bin as a row, for bins that hold more than the card limit. */
function SubBinRowItem({ subBin, timeZone }: { subBin: OutputSubBin; timeZone: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-12 py-6">
      <span className="min-w-0">
        <span className="block body-small font-medium truncate">{subBin.code}</span>
        <span className="block body-caption text-[var(--color-text-tertiary)] tabular-nums">Added {formatFacilityDateTime(subBin.placedAt, timeZone)}</span>
      </span>
      <span className="body-small tabular-nums text-right">{subBinWetText(subBin)}</span>
      <span className="body-caption text-[var(--color-text-secondary)] tabular-nums text-right">{subBinMoistureText(subBin)} moisture</span>
      <SubBinInfo subBin={subBin} timeZone={timeZone} />
    </li>
  );
}

/** A split bin's sub-bins, oldest first: cards up to the limit, rows past it. */
export function SubBinList({ subBins, timeZone, label }: { subBins: OutputSubBin[]; timeZone: string; label: string }) {
  if (subBins.length > SUB_BIN_CARD_LIMIT) {
    return (
      <ul aria-label={label} className="flex flex-col gap-4">
        {subBins.map((subBin) => <SubBinRowItem key={subBin.layerId} subBin={subBin} timeZone={timeZone} />)}
      </ul>
    );
  }
  return (
    <ul aria-label={label} className="grid grid-cols-1 sm:grid-cols-2 gap-8">
      {subBins.map((subBin) => <SubBinCard key={subBin.layerId} subBin={subBin} timeZone={timeZone} />)}
    </ul>
  );
}
