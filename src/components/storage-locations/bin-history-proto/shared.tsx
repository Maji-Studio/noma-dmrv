/** PROTOTYPE (issue #1004): small pieces the three variants share. Each variant owns its layout. */
"use client";

import { MASS_CATEGORY_FILLS } from "@/components/forms/composition-ledger";
import { batchAccentFill } from "@/components/ui/segment-bar/segment-bar";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { WATER_LABEL, WATER_SOURCE, WATER_UNKNOWN, formatKg, partDelta, type EntryParts, type Part } from "./parts";

const ICON_PX = 16;
const SWATCH = "inline-block size-12 shrink-0 border border-[var(--color-border-secondary)]";

export function partFill(part: Part): { className: string; style?: { background: string } } {
  if (part.kind === "biochar") return { className: MASS_CATEGORY_FILLS["dry-biochar"] };
  if (part.kind === "water") return { className: MASS_CATEGORY_FILLS["existing-water"] };
  return { className: "", style: { background: batchAccentFill(part.index ?? 0) } };
}

export function Swatch({ part }: { part: Part }) {
  const fill = partFill(part);
  return <span aria-hidden="true" className={`${SWATCH} ${fill.className} ${part.kg === null ? "border-dashed" : ""}`} style={part.kg === null ? undefined : fill.style} />;
}

/** The part's name; water carries where its figure comes from on a second line. */
export function PartName({ part, inline = false }: { part: Part; inline?: boolean }) {
  if (part.kind !== "water") return <span>{part.label}</span>;
  return inline
    ? <span>{WATER_LABEL} <span className="text-[var(--color-text-tertiary)]">({WATER_SOURCE})</span></span>
    : <span className="flex flex-col">{WATER_LABEL}<span className="text-[var(--color-text-tertiary)]">{WATER_SOURCE}</span></span>;
}

/** The part's figure, or the unknown wording. */
export function PartValue({ part }: { part: Part }) {
  return part.kg === null
    ? <span className="text-[var(--color-text-tertiary)]">{WATER_UNKNOWN}</span>
    : <span>{formatKg(part.kg)}</span>;
}

function signed(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toLocaleString()}`;
}

/** One row per part: swatch, name, figure with what the entry changed beside it. Unknown water takes its own line. */
export function PartList({ parts, against, reserveDelta = false }: { parts: Part[]; against?: Part[]; reserveDelta?: boolean }) {
  return (
    <ul className="flex flex-col gap-6 tabular-nums">
      {parts.map((part) => {
        const delta = against ? partDelta(against.find((item) => item.key === part.key), part) : null;
        return (
          <li key={part.key} className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-start gap-x-8 gap-y-2 body-caption">
            <span className="pt-2"><Swatch part={part} /></span>
            <span className="min-w-0"><PartName part={part} /></span>
            {part.kg === null ? <span className="col-span-2 col-start-2"><PartValue part={part} /></span> : (
              <span className="flex flex-col items-end whitespace-nowrap text-right">
                <PartValue part={part} />
                {(delta !== null || reserveDelta) && <span className="text-[var(--color-text-tertiary)]">{delta === null ? "\u00a0" : signed(delta)}</span>}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Before and after as two blocks with an arrow between, each block free to hold more than a figure. */
export function BlockPair({ before, after }: { before: ReactNode; after: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-8">
      {before}
      <ArrowRightIcon size={ICON_PX} aria-label="to" className="mt-12 text-[var(--color-text-tertiary)]" />
      {after}
    </div>
  );
}

export function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-8 bg-[var(--clr-dark-purple-5)] px-10 py-8">
      <span className="body-caption text-[var(--color-text-tertiary)]">{label}</span>
      {children}
    </div>
  );
}

export function sidesOf(parts: EntryParts) {
  return { before: parts.before, after: parts.after };
}
