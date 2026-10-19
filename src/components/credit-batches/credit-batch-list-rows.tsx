"use client";

/**
 * The List view of /credit-batches: one compact row per credit batch, read on
 * a phone first. Below `xl` a row is two lines (code, feedstock and state, then
 * the dates and the applied biochar), plus the menu; from `xl` the
 * same elements line up as table columns under one header. One DOM serves both:
 * the line wrappers turn into `display: contents` at `xl`, so every value is a
 * cell of the row's grid.
 *
 * State and colors are the timeline's (STATE_TONE): Open, Ready, Submitted,
 * Issued. Applied biochar is the dry mass held by the batch's slices.
 */
import type { ReactNode } from "react";
import { EyeIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { RowActionsMenu } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { RecordLockOverviewChip } from "@/components/record-locks/record-lock-chip";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import type { CreditBatchTimelineFacts } from "@/data-access/credit-batch-timeline-facts";
import type { CreditBatchStateView } from "@/lib/credit-batches/batch-state";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { isRecordEditable, type RecordLockView } from "@/lib/record-lock-view";
import { cn } from "@/lib/utils";
import { BlockingCount, MUTED, STATE_TONE, StateMark } from "./credit-batch-timeline-parts";

const STATE_MARK_PX = 10;
const SKELETON_HEIGHT_PX = 14;
const STATE_SKELETON_WIDTH_PX = 56;
const FIGURE_SKELETON_WIDTH_PX = 48;
const UNNAMED_FEEDSTOCK = "Feedstock not set";
export const APPLIED_DRY_LABEL = "Applied (dry)";
const CODE_PREFIX = /^CB-/;

/**
 * One grid for the header and every row. Below `xl`: content, then the 44px
 * menu. From `xl`: code, feedstock, dates, production runs, applied (dry),
 * status, menu.
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_44px] items-center gap-x-8 pl-12 xl:pr-4 xl:pl-16 xl:grid-cols-[104px_minmax(0,1fr)_176px_56px_104px_minmax(0,1.2fr)_44px] xl:gap-x-16";

export type FactsStatus = "loading" | "failed" | "ready";

/**
 * Delete is refused once a Removal is Sent or a Sample uses the batch. A draft
 * Removal alone does not stop it: deleting the batch releases its slices.
 */
export function isCreditBatchDeletable(lock: RecordLockView | undefined): boolean {
  return !!lock && lock.level !== "sent" && !lock.usedBy.some((link) => link.kind === "sample");
}

/** The row's dry applied biochar: never the wet figure, never a guess. */
export function appliedDryLabel(facts: CreditBatchTimelineFacts | undefined, status: FactsStatus): string | null {
  if (status === "loading") return null;
  if (status === "failed" || !facts) return MISSING_VALUE.notAvailable;
  return formatTonnes(kgToTonnes(facts.appliedDryKg));
}

export function creditBatchRowActions({
  creditBatch,
  lock,
  onView,
  onEdit,
  onDelete,
}: {
  creditBatch: CreditBatchWithRelations;
  lock: RecordLockView | undefined;
  onView: (creditBatch: CreditBatchWithRelations) => void;
  onEdit: (creditBatch: CreditBatchWithRelations) => void;
  onDelete: (creditBatchId: string) => void;
}) {
  // Record lock (#1119): Sent offers no Edit or Delete, and both wait for the
  // lock read to answer. The sheet's lock line names the Removal; the server
  // guard enforces it.
  const locked = !isRecordEditable(lock);
  return [
    { label: "Open details", icon: <EyeIcon size={16} />, onSelect: () => onView(creditBatch) },
    ...(locked ? [] : [{ label: "Edit", icon: <PencilSimpleIcon size={16} />, onSelect: () => onEdit(creditBatch) }]),
    ...(!locked && isCreditBatchDeletable(lock)
      ? [{ label: "Delete", destructive: true, icon: <TrashIcon size={16} />, onSelect: () => onDelete(creditBatch.id) }]
      : []),
  ];
}

function BatchState({
  view,
  readinessStatus,
  lock,
}: {
  view: CreditBatchStateView;
  readinessStatus: "loading" | "failed" | "ready";
  lock: RecordLockView | undefined;
}) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-x-8 gap-y-4 xl:justify-start">
      {view.state ? (
        <span className="inline-flex items-center gap-6 body-small font-medium">
          <StateMark state={view.state} size={STATE_MARK_PX} />
          {STATE_TONE[view.state].title}
        </span>
      ) : readinessStatus === "loading" ? (
        <Skeleton width={STATE_SKELETON_WIDTH_PX} height={SKELETON_HEIGHT_PX} />
      ) : (
        <span className={cn("body-small", MUTED)}>{MISSING_VALUE.notAvailable}</span>
      )}
      {view.blockingCount > 0 && (
        <span className={cn("inline-flex items-center gap-6 body-small", MUTED)}>
          {/* Named in words where a row has room; a phone shows the timeline's count bubble alone. */}
          <span className="max-xl:sr-only">Missing data</span>
          <BlockingCount count={view.blockingCount} aria-hidden />
          <span className="sr-only">{view.blockingCount}</span>
        </span>
      )}
      <LockChip lock={lock} className="hidden xl:inline-flex" />
    </span>
  );
}

/** Overview rows show the lock only once Sent, like every other list (#1162). */
function LockChip({ lock, className }: { lock: RecordLockView | undefined; className?: string }) {
  return <RecordLockOverviewChip lock={lock} className={className} />;
}

export function CreditBatchListRow({
  creditBatch,
  view,
  readinessStatus,
  facts,
  factsStatus,
  lock,
  onView,
  onEdit,
  onDelete,
}: {
  creditBatch: CreditBatchWithRelations;
  view: CreditBatchStateView;
  readinessStatus: "loading" | "failed" | "ready";
  facts: CreditBatchTimelineFacts | undefined;
  factsStatus: FactsStatus;
  /** The batch's record lock, from the list's one batched read. */
  lock: RecordLockView | undefined;
  onView: (creditBatch: CreditBatchWithRelations) => void;
  onEdit: (creditBatch: CreditBatchWithRelations) => void;
  onDelete: (creditBatchId: string) => void;
}) {
  const applied = appliedDryLabel(facts, factsStatus);
  const dates = formatDateRange(creditBatch.startDate, creditBatch.endDate);
  const codePrefix = CODE_PREFIX.exec(creditBatch.code)?.[0] ?? "";
  return (
    // The whole row is a pointer convenience; the code button is the keyboard
    // and screen-reader route to the same view (no role or tabIndex on the row).
    <li
      data-credit-batch-row={creditBatch.code}
      className={cn(ROW_GRID, "cursor-pointer py-12 transition-colors hover:bg-[var(--row-hover-bg)] [border-bottom:var(--row-divider)] last:[border-bottom:none] xl:py-8")}
      onClick={() => onView(creditBatch)}
    >
      <div className="flex min-w-0 flex-col gap-4 xl:contents">
        <div className="flex min-w-0 items-center justify-between gap-12 xl:contents">
          <div className="flex min-w-0 items-baseline gap-8 xl:contents">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onView(creditBatch);
              }}
              aria-label={`Open credit batch ${creditBatch.code}`}
              className="shrink-0 cursor-pointer text-left body-small font-medium tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)] xl:col-start-1 xl:row-start-1"
            >
              {/* Every row is a credit batch, so a phone drops the shared "CB-" prefix as the timeline bars do; the label keeps the full code. */}
              {codePrefix && <span className="max-xl:hidden">{codePrefix}</span>}
              {creditBatch.code.slice(codePrefix.length)}
            </button>
            <span className={cn("min-w-0 truncate body-small xl:col-start-2 xl:row-start-1 xl:text-[var(--color-text-primary)]", MUTED)}>
              {creditBatch.feedstockTypeName ?? UNNAMED_FEEDSTOCK}
            </span>
          </div>
          <div className="shrink-0 xl:col-start-6 xl:row-start-1">
            <BatchState view={view} readinessStatus={readinessStatus} lock={lock} />
          </div>
        </div>
        <div className="flex min-w-0 items-baseline justify-between gap-12 xl:contents">
          {/* A caption on the two-line row, body text in the table; only one is ever displayed. */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-4 xl:hidden">
            <span className={cn("body-caption", MUTED)}>{dates}</span>
            <LockChip lock={lock} />
          </span>
          <span className={cn("hidden body-small xl:col-start-3 xl:row-start-1 xl:block", MUTED)}>{dates}</span>
          <span className="hidden body-small tabular-nums xl:col-start-4 xl:row-start-1 xl:block xl:text-right">
            <span className="sr-only">Production runs </span>
            {creditBatch.productionRunCount}
          </span>
          <span className="inline-flex shrink-0 items-baseline gap-6 xl:col-start-5 xl:row-start-1 xl:justify-end">
            <span className={cn("body-caption xl:sr-only", MUTED)}>{APPLIED_DRY_LABEL}</span>
            {applied === null ? (
              <Skeleton width={FIGURE_SKELETON_WIDTH_PX} height={SKELETON_HEIGHT_PX} />
            ) : (
              <span
                data-applied-dry
                className={cn(
                  "body-small tabular-nums",
                  applied === MISSING_VALUE.notAvailable ? "text-[var(--color-text-tertiary)]" : "font-medium",
                )}
              >
                {applied}
              </span>
            )}
          </span>
        </div>
      </div>
      <RowActionsMenu
        label={`Actions for credit batch ${creditBatch.code}`}
        className="flex justify-center self-center [&>button]:size-44 xl:col-start-7 xl:row-start-1"
        actions={creditBatchRowActions({ creditBatch, lock, onView, onEdit, onDelete })}
      />
    </li>
  );
}

/** The framed list: a column header from `xl`, then one row per batch. */
export function CreditBatchListRows({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[var(--panel-bg)] [border:var(--panel-border)]">
      {/* Each row names its own values for screen readers, so the header is visual only. */}
      <div
        className={cn(ROW_GRID, "hidden bg-[var(--panel-head-bg)] py-10 [border-bottom:var(--panel-head-border)] xl:grid")}
        aria-hidden
      >
        {["Credit batch", "Feedstock", "Dates", "Runs", APPLIED_DRY_LABEL, "Status"].map((label, index) => (
          <span
            key={label}
            className={cn("body-small font-medium text-[var(--color-text-secondary)]", (index === 3 || index === 4) && "text-right")}
          >
            {label}
          </span>
        ))}
      </div>
      <ul aria-label="Credit batches">{children}</ul>
    </div>
  );
}
