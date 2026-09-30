"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";

const ICON_PX = 16;

function ChangeBlock({ label, figure, caption, muted }: {
  label: string;
  figure: string;
  caption: string;
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-[var(--color-background-light)] px-12 py-10">
      <span className="body-caption text-[var(--color-text-secondary)]">{label}</span>
      <span className={`body-large font-medium tabular-nums ${muted ? "text-[var(--color-text-tertiary)]" : ""}`}>{figure}</span>
      <span className="body-caption text-[var(--color-text-secondary)]">{caption}</span>
    </div>
  );
}

/**
 * What a feedstock loss does to the bin, as two blocks with an arrow: the wet
 * stock now (with its estimated moisture), then the wet stock once the mass
 * typed above is taken out. The after block waits for a usable mass.
 */
export function FeedstockLossChange({ beforeKg, moisturePercent, lossKg, blocked }: {
  beforeKg: number | null;
  moisturePercent: number | null;
  lossKg: number | null;
  /** True while the entered mass is more than the bin holds. */
  blocked: boolean;
}) {
  const afterKg = beforeKg !== null && lossKg !== null && !blocked ? beforeKg - lossKg : null;
  const beforeFigure = formatMassKg(beforeKg);
  const afterFigure = afterKg === null ? "Enter a mass" : formatMassKg(afterKg);
  const beforeCaption = `wet estimate, ${formatMoisturePercent(moisturePercent)} moisture`;
  return (
    <div
      role="group"
      aria-label={`Stock now ${beforeFigure}, ${beforeCaption}. After this loss ${afterKg === null ? "not known yet" : afterFigure}`}
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-8"
    >
      <ChangeBlock label="In the bin now" figure={beforeFigure} caption={beforeCaption} muted />
      <ArrowRightIcon size={ICON_PX} aria-hidden="true" className="text-[var(--color-icon-secondary)]" />
      <ChangeBlock label="After this loss" figure={afterFigure} caption="wet estimate" muted={afterKg === null} />
    </div>
  );
}
