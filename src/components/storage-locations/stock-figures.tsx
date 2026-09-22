/**
 * Shared figure shapes for the stock surfaces (preview, history, correction).
 *
 * Every number an operator has to compare lives in one of three shapes, so the
 * same quantity reads the same way in a preview card, a history entry and a
 * correction form:
 *
 *  - `StockBalanceChange` — the consequence: one balance before and after.
 *  - `StockRows` — the inputs: label left, tabular figure right.
 *  - `CalculationDisclosure` — arithmetic the rows do not already show.
 *
 * Prose is deliberately absent. A sentence that only restates a row belongs in
 * an `InfoHint` on the surface's title, not in this file.
 */
"use client";

import {
  ArrowRightIcon,
  CaretDownIcon,
  CaretUpIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";

/** "12 kg at 30% moisture", or just the mass when no moisture was measured. */
export function formatWetAtMoisture(
  wetMassKg: number | null | undefined,
  moisturePercent: number | null | undefined,
): string {
  const wet = formatMassKg(wetMassKg);
  return moisturePercent == null
    ? wet
    : `${wet} at ${formatMoisturePercent(moisturePercent)} moisture`;
}

export interface StockRow {
  label: string;
  value: ReactNode;
}

/** Aligned label/value pairs. Never render these figures as a sentence. */
export function StockRows({ label, rows }: { label: string; rows: StockRow[] }) {
  return (
    <dl aria-label={label} className="space-y-6">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-12"
        >
          <dt className="body-caption text-[var(--color-text-secondary)]">
            {row.label}
          </dt>
          <dd className="body-small tabular-nums text-right">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Inline before/after for a row value, when the headline is used elsewhere. */
export function InlineMassChange({
  beforeKg,
  afterKg,
}: {
  beforeKg: number | null;
  afterKg: number | null;
}) {
  return (
    <span className="inline-flex items-center gap-6">
      <span className="text-[var(--color-text-tertiary)]">
        {formatMassKg(beforeKg)}
      </span>
      <ArrowRightIcon
        size={12}
        aria-hidden="true"
        className="shrink-0 text-[var(--color-icon-secondary)]"
      />
      <span>{formatMassKg(afterKg)}</span>
    </span>
  );
}

/**
 * The headline of a stock surface: one balance, before and after the movement.
 *
 * An unchanged balance is the answer to a question the operator asked, not a
 * missing result, so it is labelled rather than left to look like a bug.
 *
 * The label is a sentence-case caption, not the uppercase mono eyebrow: a split
 * bar now sits above this pair on the stock surfaces, and two competing small
 * labels in two different type styles read as two unrelated sections.
 */
export function StockBalanceChange({
  label,
  beforeKg,
  afterKg,
  supportingLine,
}: {
  label: string;
  beforeKg: number | null;
  afterKg: number | null;
  supportingLine?: ReactNode;
}) {
  const unchanged =
    beforeKg !== null && afterKg !== null && beforeKg === afterKg;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-8">
        <span className="body-caption text-[var(--color-text-secondary)]">
          {label}
        </span>
        {unchanged && <StockChip>Unchanged</StockChip>}
      </div>
      <div
        className="flex items-center gap-10"
        role="group"
        aria-label={`${label}: ${formatMassKg(beforeKg)} before, ${formatMassKg(afterKg)} after`}
      >
        <span className="body-large tabular-nums text-[var(--color-text-tertiary)]">
          {formatMassKg(beforeKg)}
        </span>
        <ArrowRightIcon
          size={18}
          aria-hidden="true"
          className="shrink-0 text-[var(--color-icon-secondary)]"
        />
        <span className="body-large font-medium tabular-nums">
          {formatMassKg(afterKg)}
        </span>
      </div>
      {supportingLine && (
        <p className="body-caption text-[var(--color-text-secondary)]">
          {supportingLine}
        </p>
      )}
    </div>
  );
}

/** Square chip naming what a record is. One per record, two at most. */
export function StockChip({
  children,
  emphasis = false,
}: {
  children: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center border px-6 py-2 body-caption-fit whitespace-nowrap ${
        emphasis
          ? "border-[var(--color-border-primary)] text-[var(--color-text-primary)] font-medium"
          : "border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)]"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * One line, one icon. Blocking refusals are errors; everything else is a status
 * the operator can read and keep working.
 */
export function StockNotice({
  children,
  tone = "warning",
  role = "status",
}: {
  children: ReactNode;
  tone?: "warning" | "error";
  role?: "status" | "alert";
}) {
  return (
    <p
      role={role}
      className={`flex items-start gap-8 body-caption ${
        tone === "error" ? "text-[var(--st-bad)]" : "text-[var(--st-wait)]"
      }`}
    >
      <WarningCircleIcon
        size={16}
        aria-hidden="true"
        className="mt-2 shrink-0"
      />
      <span>{children}</span>
    </p>
  );
}

/**
 * "Show calculation" for surfaces that are not a `CompositionCard` — a history
 * entry or a bare form section. Same label, caret and quiet weight as the card,
 * so the control means one thing everywhere.
 */
export function CalculationDisclosure({
  subject,
  children,
}: {
  /** Names what is being calculated, for the control's accessible label. */
  subject: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const CaretIcon = open ? CaretUpIcon : CaretDownIcon;
  return (
    <div className="space-y-8">
      <Button
        data-presentation-control
        type="button"
        variant="noOutline"
        className="min-h-44 gap-6 px-8 normal-case"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${open ? "Hide" : "Show"} calculation for ${subject}`}
        onClick={() => setOpen(!open)}
      >
        <span className="body-caption normal-case">
          {open ? "Hide calculation" : "Show calculation"}
        </span>
        <CaretIcon size={14} className="shrink-0" aria-hidden="true" />
      </Button>
      <div
        id={id}
        hidden={!open}
        className="space-y-8 border-t border-[var(--color-border-secondary)] pt-8"
      >
        {children}
      </div>
    </div>
  );
}
