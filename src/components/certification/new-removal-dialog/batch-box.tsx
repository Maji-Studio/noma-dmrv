/**
 * One compact box per credit batch in New Removal's selection step (#1202).
 * A box holds the batch code (a link to the batch page), its period, its
 * applied dry mass and one status line. A batch that is not ready names its
 * first open check and how many more there are, then links to its open to-dos on
 * the batch page; the full list lives there, never here.
 */
"use client";

import { recordHref } from "@/lib/record-links";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { certCheckLabel } from "@/lib/certification/requirement-labels";
import { CREDIT_BATCH_READY_LABEL } from "@/lib/certification/credit-batch-lifecycle";
import type { BatchHealth } from "@/lib/certification/batch-health";
import type { SelectableBatch } from "@/fn/certification";
// The link names the panel it lands on (Kenji, 2026-10-20).
import { OPEN_TODOS_LABEL } from "@/lib/credit-batches/batch-page";
import { cn } from "@/lib/utils";
import { INLINE_HIT_AREA, INLINE_HIT_AREA_FROM_SM } from "@/components/ui/touch-target";

const STATUS_ICON = 14;
const LINK_ICON = 12;

/**
 * The one status line of a not-ready batch: the count of open checks and the
 * first one, named as the batch page names it ("3 issues: 17 components to decide
 * and 2 more").
 */
export function batchIssueLine(health: BatchHealth): string {
  const unmet = health.checks.filter((check) => check.status === "unmet");
  const count = health.issueCount;
  const noun = count === 1 ? "issue" : "issues";
  const [first] = unmet;
  if (!first) return `${count} ${noun}`;
  const more = count - 1;
  return `${count} ${noun}: ${certCheckLabel(first)}${more > 0 ? ` and ${more} more` : ""}`;
}

function StatusLine({
  ok,
  className,
  children,
}: {
  ok?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-start gap-6 body-caption font-medium",
        ok ? "text-[var(--st-ok)]" : "text-[var(--color-signal-orange-strong)]",
        className,
      )}
    >
      {ok ? (
        <CheckCircleIcon size={STATUS_ICON} weight="fill" aria-hidden className="mt-2 shrink-0" />
      ) : (
        <WarningIcon size={STATUS_ICON} weight="fill" aria-hidden className="mt-2 shrink-0" />
      )}
      <span>{children}</span>
    </span>
  );
}

function BatchCodeLink({ batch, facilityId }: { batch: SelectableBatch; facilityId: string }) {
  return (
    <Link
      href={recordHref("creditBatch", batch.id, { facilityId })}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(INLINE_HIT_AREA, "inline-flex items-center gap-4 body-small font-medium font-mono text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline")}
    >
      {batch.code}
      <ArrowSquareOutIcon size={LINK_ICON} aria-hidden />
    </Link>
  );
}

function BatchHeading({ batch, facilityId }: { batch: SelectableBatch; facilityId: string }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
      <BatchCodeLink batch={batch} facilityId={facilityId} />
      <span className="body-small text-[var(--color-text-secondary)]">
        {formatDateRange(batch.startDate, batch.endDate)}
      </span>
    </span>
  );
}

/** Applied dry mass of the slices not yet in a Removal. It is derived, so an unknown mass is left out, never a zero. */
function DryMass({ tons, className }: { tons: number | null; className?: string }) {
  if (tons == null) return null;
  return (
    <span
      className={cn(
        "body-small font-mono tabular-nums whitespace-nowrap text-right text-[var(--color-text-primary)]",
        className,
      )}
    >
      {formatTonnes(tons)} dry
    </span>
  );
}

export function ReadyBatchBox({
  batch,
  facilityId,
  selected,
  disabled,
  onToggle,
}: {
  batch: SelectableBatch;
  facilityId: string;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <li
      className={cn(
        "border bg-[var(--color-background-white)] transition-colors",
        selected
          ? "border-[var(--color-interaction)]"
          : "border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)]",
        disabled && "opacity-60",
      )}
    >
      <label
        className={cn(
          "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-12 gap-y-4 px-16 py-12",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <input
          type="checkbox"
          className="mt-4 size-16 shrink-0 accent-[var(--color-interaction)]"
          checked={selected}
          disabled={disabled}
          onChange={() => onToggle(batch.id)}
          aria-label={`Select credit batch for ${formatDateRange(batch.startDate, batch.endDate)}, ${batch.code}`}
        />
        <span className="flex min-w-0 flex-col gap-2">
          <BatchHeading batch={batch} facilityId={facilityId} />
          {/* relative: paints above the code link's enlarged hit area, so a click here still toggles the label's checkbox. */}
          <StatusLine ok className="relative">{CREDIT_BATCH_READY_LABEL}</StatusLine>
        </span>
        <DryMass tons={batch.appliedDryTons} />
      </label>
    </li>
  );
}

export function NotReadyBatchBox({
  batch,
  facilityId,
}: {
  batch: SelectableBatch;
  facilityId: string;
}) {
  return (
    // Phone: the to-dos link takes its own row so the status line keeps
    // the width. From sm it sits beside the status line.
    // pl-44 = 16 padding + 16 checkbox + 12 gap, the text column of ReadyBatchBox.
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-12 gap-y-2 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] pt-12 pr-16 pb-4 pl-44 sm:pb-12">
      <span className="col-start-1 row-start-1 min-w-0">
        <BatchHeading batch={batch} facilityId={facilityId} />
      </span>
      <DryMass tons={batch.appliedDryTons} className="col-start-2 row-start-1" />
      <span className="col-span-2 row-start-2 sm:col-span-1">
        <StatusLine>{batchIssueLine(batch.health)}</StatusLine>
      </span>
      <Link
        href={recordHref("creditBatch", batch.id, { facilityId })}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${OPEN_TODOS_LABEL} for ${batch.code}`}
        className={cn(INLINE_HIT_AREA_FROM_SM, "col-start-1 row-start-3 inline-flex min-h-44 items-center gap-4 justify-self-start body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline sm:col-start-2 sm:row-start-2 sm:min-h-0 sm:justify-self-end")}
      >
        {OPEN_TODOS_LABEL}
        <ArrowSquareOutIcon size={LINK_ICON} aria-hidden />
      </Link>
    </li>
  );
}
