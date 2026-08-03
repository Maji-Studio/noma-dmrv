/**
 * SheetLinkRow — the single row pattern for "related records" lists inside the
 * credit-batch side sheet (member production runs, pooled lab samples).
 *
 * The sheet used to draw each list differently (bordered link cards for runs,
 * flush divided rows for samples), which made one panel read as several. One
 * row shape now covers both: flush divided rows, identity on the left, a meta
 * slot on the right, and a trailing arrow that marks every row as navigable.
 */
"use client";

import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";

/** Divider frame around a set of rows. */
export function SheetLinkRows({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-[var(--color-border-tertiary)] border-y border-[var(--color-border-tertiary)]">
      {children}
    </div>
  );
}

export function SheetLinkRow({
  href,
  primary,
  secondary,
  meta,
  ariaLabel,
}: {
  href: string;
  /** The record's identifier — its code. */
  primary: React.ReactNode;
  /** Optional second line under the code (date, provenance). */
  secondary?: React.ReactNode;
  /** Right-hand detail (status badge, figure). */
  meta?: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="group flex min-w-0 items-center justify-between gap-12 py-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
    >
      <span className="flex min-w-0 flex-col gap-2">
        <span className="truncate body-small font-medium text-[var(--color-text-primary)] group-hover:underline">
          {primary}
        </span>
        {secondary && (
          <span className="truncate body-caption text-[var(--color-text-tertiary)]">
            {secondary}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-10">
        {meta}
        <ArrowRightIcon
          size={14}
          className="text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-primary)]"
          aria-hidden
        />
      </span>
    </Link>
  );
}
