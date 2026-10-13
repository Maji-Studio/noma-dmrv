/**
 * The stock history's ledger, shared by feedstock and output bins: days as
 * headers, one line per operator action with its own size and the stock left
 * after, and the detail of that action opening under its line.
 */
"use client";

import { ArrowRightIcon, CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { StockKindIcon } from "./stock-kind-icons";
import { StockChip } from "./stock-figures";

const ICON_PX = 16;
const CARET_ICON_PX = 14;

export function LedgerDayHeader({ day, afterLabel }: { day: string; afterLabel?: string }) {
  return (
    <div className="flex justify-between border-b border-[var(--clr-dark-purple-40)] pb-4 pt-12 body-caption text-[var(--color-text-tertiary)]">
      <span>{day}</span>{afterLabel && <span>{afterLabel}</span>}
    </div>
  );
}

export function LedgerLine({ id, time, iconKind, label, chips = [], note, amount, after, struck = false, defaultOpen = false, children }: {
  id: string;
  time: string;
  iconKind: string;
  label: string;
  chips?: string[];
  note?: string;
  amount: string;
  after: string;
  /** A corrected entry: kept in the list, struck through. */
  struck?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details id={id} open={defaultOpen} className="group border-b border-[var(--color-border-secondary)]">
      <summary className="grid cursor-pointer list-none grid-cols-[40px_16px_minmax(0,1fr)_auto_14px] items-start gap-8 py-10 hover:bg-[var(--clr-dark-purple-5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] [&::-webkit-details-marker]:hidden">
        <span className="pt-2 body-caption tabular-nums text-[var(--color-text-tertiary)]">{time}</span>
        <StockKindIcon kind={iconKind} size={ICON_PX} className={`mt-2 ${struck ? "text-[var(--color-text-tertiary)]" : "text-[var(--color-text-primary)]"}`} />
        <span className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-6 body-small font-medium">
            <span className={struck ? "text-[var(--color-text-tertiary)]" : undefined}>{label}</span>
            {chips.map((chip) => <StockChip key={chip}>{chip}</StockChip>)}
          </span>
          {note && <span className="truncate body-caption text-[var(--color-text-tertiary)]">{note}</span>}
        </span>
        <span className="flex flex-col text-right tabular-nums">
          <span className={`body-small font-medium ${struck ? "line-through text-[var(--color-text-tertiary)]" : ""}`}>{amount}</span>
          <span className="body-caption text-[var(--color-text-tertiary)]">{after}</span>
        </span>
        <CaretDownIcon size={CARET_ICON_PX} aria-hidden="true" className="mt-4 text-[var(--color-text-tertiary)] transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="flex flex-col gap-10 pb-16 sm:pl-64">{children}</div>
    </details>
  );
}

/** A mode change or other event that moves no stock: a break in the list, not a line item. */
export function LedgerBreak({ id, iconKind, title, caption, source }: { id: string; iconKind: string; title: string; caption: string; source?: ReactNode }) {
  return (
    <div id={id} className="flex items-start gap-8 border-b border-[var(--color-border-secondary)] py-10 body-caption text-[var(--color-text-secondary)]">
      <StockKindIcon kind={iconKind} size={ICON_PX} className="text-[var(--color-text-tertiary)]" />
      <span><span className="font-medium text-[var(--color-text-primary)]">{title}.</span> {caption}{source}</span>
    </div>
  );
}

function FigureBlock({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="flex min-w-0 flex-col bg-[var(--clr-dark-purple-5)] px-10 py-8">
      <span className="body-caption text-[var(--color-text-tertiary)]">{label}</span>
      <span className="body-small font-medium tabular-nums">{value}</span>
      {caption && <span className="body-caption tabular-nums text-[var(--color-text-secondary)]">{caption}</span>}
    </div>
  );
}

interface FigureSide { value: string; caption?: string }

/** Before and after as two blocks with an arrow between, optionally under a title naming what changed. */
export function LedgerBeforeAfter({ title, before, after, labels = ["Before", "After"] }: {
  title?: string;
  before: string | FigureSide;
  after: string | FigureSide;
  labels?: [string, string];
}) {
  const side = (figure: string | FigureSide): FigureSide => (typeof figure === "string" ? { value: figure } : figure);
  return (
    <div className="flex flex-col gap-4">
      {title && <span className="body-caption text-[var(--color-text-secondary)]">{title}</span>}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-8">
        <FigureBlock label={labels[0]} {...side(before)} />
        <ArrowRightIcon size={ICON_PX} aria-label="to" className="text-[var(--color-text-tertiary)]" />
        <FigureBlock label={labels[1]} {...side(after)} />
      </div>
    </div>
  );
}

export function LedgerFacts({ facts }: { facts: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-16 gap-y-2 body-caption">
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-[var(--color-text-tertiary)]">{fact.label}</dt>
          <dd className="min-w-0">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
