/**
 * Parts of Review & submit (D1a, #1554): the fix rows, the one-time "All N
 * fixed" note, the returned view and the destination header. Every fix is a
 * short title with its full message behind an (i), and its repair as a text
 * link under the title that opens in a new tab.
 */
"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowRightIcon,
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  ShieldWarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { Notice } from "@/components/ui/notice";
import { INLINE_HIT_AREA_FROM_SM } from "@/components/ui/touch-target";
import { pluralize } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
import type { FixEntry } from "./use-fix-progress";
import type { ReviewItem } from "./review-items";

const MARKER_SIZE = 20;
export const REVIEW_TITLE_ID = "new-removal-title";
const MUTED = "text-[var(--color-text-secondary)]";
const TERTIARY = "text-[var(--color-text-tertiary)]";
const ROW_DIVIDER = "[border-top:var(--row-divider)] first:[border-top:none]";
const LINK_CLASS = cn(
  "inline-flex min-h-44 shrink-0 items-center gap-4 self-start body-small text-[var(--color-text-primary)] underline underline-offset-4 sm:min-h-0",
  INLINE_HIT_AREA_FROM_SM,
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
);

/** The title with its (i). The last word travels with the glyph so it never wraps alone. */
function TitleWithInfo({ item, className }: { item: ReviewItem; className?: string }) {
  const hasInfo = item.explanation !== null || item.lines.length > 0 || item.batchCode !== null;
  const cut = item.title.lastIndexOf(" ");
  const head = cut > 0 ? `${item.title.slice(0, cut)} ` : "";
  const tail = item.title.slice(cut + 1);
  return (
    <span className={className}>
      {head}
      <span className="whitespace-nowrap">
        {tail}
        {hasInfo && (
          <ExplanationInfo title={item.title} hint={item.explanation ?? undefined}>
            {item.lines.length > 0 && (
              <ul className={cn("list-disc pl-16 body-caption", MUTED)}>
                {item.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {item.batchCode && (
              <p className={cn("body-caption", MUTED)}>
                Credit batch <span className="font-mono">{item.batchCode}</span>
              </p>
            )}
          </ExplanationInfo>
        )}
      </span>
    </span>
  );
}

/** A repair that opens its record in a new tab. */
export function FixLink({ href, children, onClick }: { href: string; children: ReactNode; onClick?: () => void }) {
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" onClick={onClick} className={LINK_CLASS}>
      {children}
      <ArrowSquareOutIcon size={14} aria-hidden />
    </Link>
  );
}

/**
 * One fix or note. A fix carries a quiet dashed ring that becomes a check once
 * fixed; a note carries nothing. The repair links sit under the title.
 */
export function ReviewRow({
  item,
  fixed = false,
  marker = false,
  onFix,
}: {
  item: ReviewItem;
  fixed?: boolean;
  marker?: boolean;
  onFix?: () => void;
}) {
  const textClass = marker ? "body-medium font-medium" : "body-small";
  return (
    <li
      data-review-item={fixed ? "fixed" : "open"}
      className={cn("grid gap-x-12 py-10", ROW_DIVIDER, marker ? "grid-cols-[20px_minmax(0,1fr)]" : "grid-cols-1")}
    >
      {marker &&
        (fixed ? (
          <CheckCircleIcon size={MARKER_SIZE} weight="fill" aria-hidden className="mt-2 text-[var(--st-ok)]" />
        ) : (
          <CircleDashedIcon size={MARKER_SIZE} aria-hidden className={cn("mt-2", TERTIARY)} />
        ))}
      <div className="flex min-w-0 flex-col items-start gap-2">
        {fixed ? (
          <span className={cn(marker ? "body-medium" : "body-small", MUTED)}>
            {item.title}
            <span className="sr-only"> (fixed)</span>
          </span>
        ) : (
          <TitleWithInfo item={item} className={cn(textClass, "text-[var(--color-text-primary)]")} />
        )}
        {/* One group pulls in by the tap area's padding, so stacked links keep their full 44px apart. */}
        {!fixed && item.fixes.length > 0 && (
          <span className="flex flex-col items-start max-sm:-my-6">
            {item.fixes.map((fix) => (
              <FixLink key={fix.href} href={fix.href} onClick={onFix}>
                {fix.label}
              </FixLink>
            ))}
          </span>
        )}
      </div>
    </li>
  );
}

/** "Fix these to submit": the open fixes and the ones already done, in the order first seen. */
export function FixList({ entries, onFix }: { entries: readonly FixEntry[]; onFix: () => void }) {
  const open = entries.filter((entry) => !entry.fixed).length;
  return (
    <section aria-labelledby="review-fix" className="flex flex-col gap-12">
      <h3 id="review-fix" className="body-lead font-medium">
        {open === 1 ? "Fix this to submit" : "Fix these to submit"}
      </h3>
      <ul aria-label="To fix before submitting" className="flex flex-col">
        {entries.map((entry) => (
          <ReviewRow key={entry.item.id} item={entry.item} fixed={entry.fixed} marker onFix={onFix} />
        ))}
      </ul>
    </section>
  );
}

/** Shown once, after the last fix: the list the operator worked through is gone, so this says where it went. */
export function FixedAck({ entries }: { entries: readonly FixEntry[] }) {
  const fixed = entries.filter((entry) => entry.fixed).length;
  if (fixed === 0 || fixed < entries.length) return null;
  return <Notice tone="success" title={`${fixed === 1 ? "Fixed" : `All ${fixed} fixed`}. Ready to submit.`} />;
}

/** "N checks passed": a count the operator can open, each passed check with its tick. */
export function PassedChecks({ checks }: { checks: readonly string[] }) {
  const [open, setOpen] = useState(false);
  if (checks.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex min-h-44 items-center gap-6 self-start body-small hover:text-[var(--color-text-primary)] sm:min-h-32",
          MUTED,
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
        )}
      >
        <CheckCircleIcon size={16} weight="fill" aria-hidden className="text-[var(--st-ok)]" />
        {checks.length} {pluralize(checks.length, "check", "checks")} passed
        <CaretDownIcon size={12} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="flex flex-col gap-4 pl-4">
          {checks.map((check) => (
            <li key={check} className={cn("flex items-baseline gap-6 body-caption", MUTED)}>
              <CheckCircleIcon size={12} weight="fill" aria-hidden className="shrink-0 translate-y-2 text-[var(--st-ok)]" />
              {check}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- returned

export interface ChangedFigure {
  key: string;
  component: string;
  batchCode: string;
  /** The figure when last submitted. Absent when the data does not carry it. */
  before?: string;
  after?: string;
}

export function ValueBlock({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-[var(--color-background-light)] px-12 py-10">
      <span className={cn("body-caption", MUTED)}>{label}</span>
      <span className={cn("body-large font-medium tabular-nums", muted && TERTIARY)}>{value}</span>
    </div>
  );
}

/**
 * Why a returned Removal needs a resubmit: how many figures changed, then each
 * changed component. With both figures it shows them as two blocks with an
 * arrow, then and now; without them it names the component and credit batch.
 */
export function ChangedGroup({ changes }: { changes: readonly ChangedFigure[] }) {
  if (changes.length === 0) return null;
  return (
    <section aria-labelledby="review-changed" className="flex flex-col gap-16">
      <div className="flex flex-col gap-4">
        <h3 id="review-changed" className="body-lead font-medium">
          {changes.length} {pluralize(changes.length, "figure", "figures")} changed since you submitted
        </h3>
        <p className={cn("body-small", MUTED)}>
          {changes.length === 1 ? "Resubmit to send the new figure." : "Resubmit to send the new figures."}
        </p>
      </div>
      <ul className="flex flex-col gap-16">
        {changes.map((change) => (
          <li key={change.key} className="flex flex-col gap-8">
            <span className="body-medium text-[var(--color-text-primary)]">
              {change.component} <span className={cn("font-mono body-small", MUTED)}>{change.batchCode}</span>
            </span>
            {change.before && change.after && (
              <div
                role="group"
                aria-label={`${change.component}: ${change.before} when submitted, ${change.after} now`}
                className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-8 sm:max-w-[400px]"
              >
                <ValueBlock label="When submitted" value={change.before} muted />
                <ArrowRightIcon size={16} aria-hidden className="text-[var(--color-icon-secondary)]" />
                <ValueBlock label="Now" value={change.after} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- header

/** The destination under the title: production keeps its tinted tag, sandbox is a quiet word. */
export function DestinationTag({ isProduction, project }: { isProduction: boolean; project: ReactNode }) {
  const suffix = project ? <> · {project}</> : null;
  if (isProduction) {
    return (
      <span className="inline-flex items-center gap-4 self-start bg-[var(--clr-red-10)] px-6 body-small font-medium text-[var(--clr-red)]">
        <ShieldWarningIcon size={14} weight="fill" aria-hidden />
        <span>Isometric production{suffix}</span>
      </span>
    );
  }
  return <span className={cn("body-small", MUTED)}>Isometric sandbox{suffix}</span>;
}
