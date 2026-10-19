"use client";

/**
 * One activity event as one node on the timeline rail: the record-type icon in
 * a circle, then what happened (the record and the kind), a quiet line with
 * who and when, and one line per changed field below (old value muted, an
 * arrow, the new value). A record with a side sheet makes the whole row a
 * link; a deleted record is a tombstone with no link.
 */
import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime, formatTime } from "@/lib/format-utils";
import { activityRecordTypeIcon } from "./activity-icons";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_KIND_LABELS,
  activityActorDisplay,
  activityChangeSummary,
  activityRecordHref,
  activityRecordLabel,
  activityRecordTypeLabel,
  activityStatusKey,
  type ActivityItem,
} from "./activity-display";
import {
  ACTIVITY_CHANGED_WORD,
  activityFieldLines,
  type ActivityFieldLine,
  type ActivityValueText,
} from "./activity-change-lines";
import { ACTIVITY_DELETED_RECORD_LABEL } from "./activity-copy";
// By file, not the barrel: the chain-of-custody barrel imports this folder.
import { ChainStatusBadge } from "@/components/chain-of-custody/chain-status-badge";

const TAG_CLASS = "inline-flex h-[20px] shrink-0 items-center border px-6 body-caption-fit font-medium";
const RECORD_ICON_PX = 16;
const TOMBSTONE_TAG_CLASS = `${TAG_CLASS} border-dashed border-[var(--color-border-primary)] text-[var(--color-text-secondary)]`;
const CHANGE_ARROW_PX = 12;
const META_SEPARATOR = "·";
type ChangeSide = "from" | "to";
/** The old value is muted, the new one reads in full ink. */
const SIDE_CLASS: Record<ChangeSide, string> = {
  from: "text-[var(--color-text-tertiary)]",
  to: "text-[var(--color-text-primary)]",
};
/** A missing value takes the placeholder treatment; a deleted record is struck through. */
const TONE_CLASS: Record<ActivityValueText["tone"], string | null> = {
  value: null,
  missing: "text-[var(--color-text-tertiary)]",
  deleted: "text-[var(--color-text-tertiary)] line-through",
};

/**
 * Before and after as two blocks with an arrow between them. Each block is
 * the shared status badge, so known statuses keep their colour; unknown
 * registry statuses fall back to a neutral badge with a readable label.
 */
function StatusChange({ label, from, to }: { label: string; from: string | null; to: string | null }) {
  if (!to) return null;
  return (
    <p className="flex flex-wrap items-center gap-6 body-caption text-[var(--color-text-secondary)]">
      <span>{label}</span>
      {from ? (
        <>
          <ChainStatusBadge status={activityStatusKey(from)} />
          <ArrowRightIcon size={CHANGE_ARROW_PX} aria-label="to" className="text-[var(--color-text-tertiary)]" />
        </>
      ) : null}
      <ChainStatusBadge status={activityStatusKey(to)} />
    </p>
  );
}

function ChangeValue({ side, value }: { side: ChangeSide; value: ActivityValueText }) {
  return (
    <span className="min-w-0 break-words">
      <span className="sr-only">{side} </span>
      <span className={TONE_CLASS[value.tone] ?? SIDE_CLASS[side]}>{value.text}</span>
    </span>
  );
}

/**
 * One changed field: `Label: old → new`. The old value is muted; the arrow is
 * drawn, so screen readers get "from" and "to" as words instead.
 */
function FieldChange({ line }: { line: ActivityFieldLine }) {
  if (line.kind === "status") return <StatusChange label={line.label} from={line.from} to={line.to} />;
  return (
    <span
      data-testid="activity-field-change"
      className="flex min-w-0 flex-wrap items-center gap-x-6 body-caption tabular-nums text-[var(--color-text-secondary)]"
    >
      {/* The spaces keep the text readable as one phrase; the flex gap does the visual spacing. */}
      <span>{line.label}:</span>{" "}
      {line.kind === "changed" ? (
        <span>{ACTIVITY_CHANGED_WORD}</span>
      ) : (
        <>
          <ChangeValue side="from" value={line.from} />{" "}
          <ArrowRightIcon size={CHANGE_ARROW_PX} aria-hidden className="shrink-0 text-[var(--color-text-tertiary)]" />{" "}
          <ChangeValue side="to" value={line.to} />
        </>
      )}
    </span>
  );
}

/** Who and when, on the line under the title: "Ada Operator via API · 18:50". */
function EntryMeta({ item, showDate }: { item: ActivityItem; showDate: boolean }) {
  const actor = activityActorDisplay(item);
  return (
    <span className="flex flex-wrap items-baseline gap-x-6 body-caption text-[var(--color-text-tertiary)]">
      <span>
        <span className={cn(!actor.missing && "text-[var(--color-text-secondary)]")}>{actor.name}</span>
        {actor.channel ? ` ${actor.channel}` : null}
      </span>{" "}
      {/* The spaces keep the line readable as one phrase; the flex gap does the visual spacing. */}
      <span aria-hidden>{META_SEPARATOR}</span>{" "}
      <time dateTime={item.occurredAt.toISOString()} title={formatDateTime(item.occurredAt)} className="tabular-nums">
        {showDate ? formatDateTime(item.occurredAt) : formatTime(item.occurredAt)}
      </time>
    </span>
  );
}

function EntryBody({ item, showDate }: { item: ActivityItem; showDate: boolean }) {
  const typeLabel = activityRecordTypeLabel(item.entityType);
  const label = activityRecordLabel(item);
  const deleted = item.record.deleted;
  const summary = activityChangeSummary(item);
  const lines = activityFieldLines(item);
  const statusChange = item.action === "status_changed";
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "relative flex size-32 shrink-0 items-center justify-center rounded-full border bg-[var(--paper)] text-[var(--color-text-secondary)] transition-colors",
          deleted
            ? "border-dashed border-[var(--color-border-primary)]"
            : "border-[var(--color-border-secondary)] group-hover:border-[var(--color-border-primary)] group-hover:text-[var(--color-text-primary)]",
        )}
      >
        {activityRecordTypeIcon(item.entityType, RECORD_ICON_PX)}
      </span>
      <span className="flex min-w-0 flex-col gap-2 pt-6">
        <span className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-4">
          <span className="min-w-0 body-small text-[var(--color-text-primary)]">
            <span className="font-medium underline-offset-2 group-hover:underline">{label ? `${typeLabel} ${label}` : typeLabel}</span>
            {" "}
            <span className="text-[var(--color-text-secondary)]">{ACTIVITY_KIND_LABELS[item.action].toLowerCase()}</span>
          </span>
          {deleted ? (
            <span className={TOMBSTONE_TAG_CLASS} data-testid="activity-tombstone">{ACTIVITY_DELETED_RECORD_LABEL}</span>
          ) : null}
        </span>
        <EntryMeta item={item} showDate={showDate} />
        {summary || lines.length > 0 || statusChange ? (
          <span className="mt-6 flex min-w-0 flex-col gap-4">
            {summary ? <span className="body-caption text-[var(--color-text-secondary)]">{summary}</span> : null}
            {lines.map((line) => <FieldChange key={line.key} line={line} />)}
            {statusChange ? (
              <>
                <StatusChange label="Status" from={item.fromStatus} to={item.toStatus} />
                <StatusChange label="Registry status" from={item.fromRemote} to={item.toRemote} />
              </>
            ) : null}
          </span>
        ) : null}
      </span>
    </>
  );
}

/**
 * Node column, then the text. The bottom padding is the space to the next
 * node, so the rail behind the row runs through it unbroken.
 */
const ROW_CLASS = "relative grid min-h-44 min-w-0 grid-cols-[32px_minmax(0,1fr)] items-start gap-x-12 pb-20 group-last/entry:pb-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-interaction)]";
/**
 * The rail segment behind one node: from the node's centre to the next row,
 * so the first row's segment starts at its node and the last row's ends there.
 */
const RAIL_CLASS = "pointer-events-none absolute top-0 bottom-0 left-16 w-px -translate-x-1/2 bg-[var(--color-border-secondary)] group-first/entry:top-16 group-last/entry:hidden";

export function ActivityEntry({
  item,
  creditBatchId,
  focusRef,
  showDate = false,
}: {
  item: ActivityItem;
  creditBatchId: string;
  /** Receives the row's focusable element, so "Show older activity" can move focus to the first new row. */
  focusRef?: (node: HTMLElement | null) => void;
  /** Show the full date with the time, for a list with no day headings above it. */
  showDate?: boolean;
}) {
  const href = activityRecordHref(item, { creditBatchId });
  return (
    <li data-testid="activity-entry" data-kind={item.action} data-record-type={item.entityType} className="group/entry relative">
      <span aria-hidden className={RAIL_CLASS} />
      {href ? (
        <Link ref={focusRef} href={href} className={cn(ROW_CLASS, "group")}>
          <EntryBody item={item} showDate={showDate} />
        </Link>
      ) : (
        <div
          ref={focusRef}
          // Focusable by script only, so focus can land here after "Show older
          // activity" and stay once the ref moves on.
          tabIndex={-1}
          className={ROW_CLASS}
        >
          <EntryBody item={item} showDate={showDate} />
        </div>
      )}
    </li>
  );
}
