/**
 * PROTOTYPE (issue #1004): three structurally different ways to show every
 * part of the mix, before and after, under a wet total that stays the headline.
 *  - A: a disclosure under the figures expands both blocks into part lists.
 *  - B: the wet total is a button; a press opens that side's parts in a popover.
 *  - C: a stacked bar per side on a shared scale; a segment shows its exact figure.
 */
"use client";

import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react/dist/ssr";
import { useId, useState } from "react";
import { formatKg, formatWet, WATER_UNKNOWN, type EntryParts, type Part, type Side } from "./parts";
import { Block, BlockPair, PartList, PartName, PartValue, Swatch, partFill } from "./shared";
import type { VariantKey } from "./switcher";

const TITLE = "Wet stock in the bin";
const SHOW_PARTS = "Show parts";
const HIDE_PARTS = "Hide parts";
const BAR_UNKNOWN_SHARE = 12;
const PERCENT = 100;

const HEADLINE = "body-small font-medium tabular-nums";

function Title() {
  return <span className="body-caption text-[var(--color-text-secondary)]">{TITLE}</span>;
}

/** A: the blocks show the wet total; one disclosure opens the part lists inside both. */
function VariantA({ parts }: { parts: EntryParts }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const Caret = open ? CaretUpIcon : CaretDownIcon;
  return (
    <div className="flex flex-col gap-4">
      <Title />
      <div id={id}>
        <BlockPair
          before={<Block label="Before"><span className={HEADLINE}>{formatWet(parts.before)}</span>{open && <PartList parts={parts.before.parts} reserveDelta />}</Block>}
          after={<Block label="After"><span className={HEADLINE}>{formatWet(parts.after)}</span>{open && <PartList parts={parts.after.parts} against={parts.before.parts} />}</Block>}
        />
      </div>
      <Button type="button" variant="noOutline" className="-ml-8 min-h-44 w-fit gap-6 px-8 normal-case" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="body-caption normal-case">{open ? HIDE_PARTS : SHOW_PARTS}</span>
        <Caret size={14} aria-hidden="true" />
      </Button>
    </div>
  );
}

/** B: the wet total is the button; its popover lists that side's parts. */
function TotalPopover({ side, label, against }: { side: Side; label: string; against?: Part[] }) {
  return (
    <Popover
      title={`${label}: parts of the mix`}
      side="bottom"
      trigger={
        <button type="button" aria-label={`${label}: ${formatWet(side)}, show parts`} className={`${HEADLINE} flex min-h-44 w-full cursor-pointer items-center justify-between gap-6 text-left underline decoration-dotted underline-offset-4`}>
          <span>{formatWet(side)}</span>
          <CaretDownIcon size={14} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
        </button>
      }
    >
      <PartList parts={side.parts} against={against} />
    </Popover>
  );
}

function VariantB({ parts }: { parts: EntryParts }) {
  return (
    <div className="flex flex-col gap-4">
      <Title />
      <BlockPair
        before={<Block label="Before"><TotalPopover side={parts.before} label="Before" /></Block>}
        after={<Block label="After"><TotalPopover side={parts.after} label="After" against={parts.before.parts} /></Block>}
      />
    </div>
  );
}

/** C: one bar per side, widths on a shared scale so a smaller bin draws smaller. */
function knownKg(side: Side): number {
  return side.parts.reduce((total, part) => total + (part.kg ?? 0), 0);
}

function StackedBar({ side, scaleKg, label }: { side: Side; scaleKg: number; label: string }) {
  const [active, setActive] = useState<Part | null>(null);
  const known = side.parts.filter((part) => part.kg !== null && part.kg > 0);
  const unknown = side.parts.filter((part) => part.kg === null);
  const drawnShare = unknown.length > 0 ? PERCENT - BAR_UNKNOWN_SHARE : PERCENT;
  const total = knownKg(side);
  const cells = [...known, ...unknown];
  return (
    <div className="flex flex-col gap-6">
      {cells.length === 0 ? <span className="body-caption text-[var(--color-text-tertiary)]">Empty</span> : (
        <div role="group" aria-label={`${label} parts`} className="flex h-20 w-full" onMouseLeave={() => setActive(null)}>
          {cells.map((part) => {
            const fill = partFill(part);
            const width = part.kg === null ? BAR_UNKNOWN_SHARE : (part.kg / scaleKg) * drawnShare;
            return (
              <button
                key={part.key}
                type="button"
                aria-label={`${part.label}: ${part.kg === null ? WATER_UNKNOWN : formatKg(part.kg)}`}
                aria-pressed={active?.key === part.key}
                onMouseEnter={() => setActive(part)}
                onFocus={() => setActive(part)}
                onClick={() => setActive(active?.key === part.key ? null : part)}
                className={`${fill.className} h-full cursor-pointer border-y border-r border-[var(--color-border-secondary)] first:border-l ${part.kg === null ? "border-dashed" : ""} ${active?.key === part.key ? "outline outline-2 outline-[var(--color-interaction)]" : ""}`}
                style={{ width: `${width}%`, ...fill.style }}
              />
            );
          })}
        </div>
      )}
      <p aria-live="polite" className="min-h-32 body-caption tabular-nums text-[var(--color-text-secondary)]">
        {active ? <><Swatch part={active} /> <PartName part={active} inline />: <PartValue part={active} />{active.kg !== null && total > 0 && ` · ${Math.round((active.kg / total) * PERCENT)}%`}</> : <span className="text-[var(--color-text-tertiary)]">Tap a part for its figure</span>}
      </p>
    </div>
  );
}

function VariantC({ parts }: { parts: EntryParts }) {
  const scaleKg = Math.max(knownKg(parts.before), knownKg(parts.after), 1);
  const legend = parts.after.parts.length >= parts.before.parts.length ? parts.after.parts : parts.before.parts;
  return (
    <div className="flex flex-col gap-4">
      <Title />
      <BlockPair
        before={<Block label="Before"><span className={HEADLINE}>{formatWet(parts.before)}</span><StackedBar side={parts.before} scaleKg={scaleKg} label="Before" /></Block>}
        after={<Block label="After"><span className={HEADLINE}>{formatWet(parts.after)}</span><StackedBar side={parts.after} scaleKg={scaleKg} label="After" /></Block>}
      />
      <p className="flex flex-wrap gap-x-16 gap-y-4 body-caption text-[var(--color-text-secondary)]">
        {legend.map((part) => <span key={part.key} className="inline-flex items-center gap-6"><Swatch part={part} /><PartName part={part} inline /></span>)}
      </p>
    </div>
  );
}

export function BinHistoryBreakdown({ variant, parts }: { variant: VariantKey; parts: EntryParts }) {
  if (variant === "B") return <VariantB parts={parts} />;
  if (variant === "C") return <VariantC parts={parts} />;
  return <VariantA parts={parts} />;
}
