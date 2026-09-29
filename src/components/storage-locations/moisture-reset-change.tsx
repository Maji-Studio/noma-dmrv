"use client";

import { ArrowRightIcon, DropIcon } from "@phosphor-icons/react/dist/ssr";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type { OutputMoistureReset } from "@/types/output-stock";
import { formatWetEstimate } from "./stock-preview-shared";

const ICON_PX = 16;

type Side = OutputMoistureReset["before"];

function wetLine(side: Side): string {
  return side.wetKg === null ? "Wet stock not available" : `≈ ${formatWetEstimate(side.wetKg)} kg wet`;
}

/** One side of the change: the moisture as the figure, the wet stock it gives under it. */
function ResetBlock({ side, label, muted }: { side: Side; label: string; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-2 bg-[var(--color-background-light)] px-12 py-10">
      <span className="body-caption text-[var(--color-text-secondary)]">{label}</span>
      <span className={`flex items-center gap-6 body-large font-medium tabular-nums ${muted ? "text-[var(--color-text-tertiary)]" : ""}`}>
        <DropIcon size={ICON_PX} aria-hidden="true" className="shrink-0 text-[var(--color-icon-secondary)]" />
        {formatMoisturePercent(side.moisturePercent)}
      </span>
      <span className="body-caption tabular-nums text-[var(--color-text-secondary)]">{wetLine(side)}</span>
    </div>
  );
}

/**
 * What a reading does to the stock it was taken from, as two blocks with an
 * arrow between them: the remaining stock at its previous estimate, then at the
 * reading. Dry biochar does not move with moisture, so only these change.
 */
export function MoistureResetChange({ reset, named = true }: {
  reset: OutputMoistureReset;
  /** False where a chip already names the change (a history row): the caption keeps only the batches. */
  named?: boolean;
}) {
  const subject = reset.layerCodes.join(", ");
  const figureLabel = `Moisture updated for ${subject}: ${formatMoisturePercent(reset.before.moisturePercent)}, ${wetLine(reset.before)} before; ${formatMoisturePercent(reset.after.moisturePercent)}, ${wetLine(reset.after)} after`;
  return (
    <div className="flex flex-col gap-6">
      <p className="body-caption text-[var(--color-text-secondary)]">{named ? `Moisture updated · ${subject}` : subject}</p>
      <div role="group" aria-label={figureLabel} className="grid grid-cols-[1fr_auto_1fr] items-center gap-8">
        <ResetBlock side={reset.before} label="Estimate" muted />
        <ArrowRightIcon size={ICON_PX} aria-hidden="true" className="text-[var(--color-icon-secondary)]" />
        <ResetBlock side={reset.after} label="Reading" />
      </div>
    </div>
  );
}
