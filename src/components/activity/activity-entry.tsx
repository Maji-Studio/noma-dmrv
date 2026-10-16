"use client";

/**
 * One activity event as one row: a record-type icon, then what happened (the
 * record and the kind as the primary line, one line per changed field below
 * it: old value muted, an arrow, the new value), with the time and who made
 * the change quiet at the trailing edge (under the details on narrow rows).
 * A record with a side sheet makes the whole row a link; a deleted record is
 * a tombstone with no link.
 */
import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime, formatTime } from "@/lib/format-utils";
import { activityRecordTypeIcon } from "./activity-icons";
import { cn } from "@/lib/utils";
import {
  ACTIVITY_KIND_LABELS,
  activityActorDisplay,
  activityActorText,
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
const RECORD_ICON_PX = 18;
const TOMBSTONE_TAG_CLASS = `${TAG_CLASS} border-dashed border-[var(--color-border-primary)] text-[var(--color-text-secondary)]`;
const CHANGE_ARROW_PX = 12;
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

function EntryBody({ item, showDate, hideMeta }: { item: ActivityItem; showDate: boolean; hideMeta: boolean }) {
  const typeLabel = activityRecordTypeLabel(item.entityType);
  const label = activityRecordLabel(item);
  const deleted = item.record.deleted;
  const summary = activityChangeSummary(item);
  const lines = activityFieldLines(item);
  const actor = activityActorDisplay(item);
  return (
    <>
      <span
        aria-hidden
        className="row-span-2 mt-2 flex size-32 shrink-0 items-center justify-center border border-[var(--color-border-tertiary)] text-[var(--color-text-secondary)]"
      >
        {activityRecordTypeIcon(item.entityType, RECORD_ICON_PX)}
      </span>
      <span className="flex min-w-0 flex-col gap-4">
        <span className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-4">
          <span className="min-w-0 body-small text-[var(--color-text-primary)]">
            <span className="font-medium group-hover:underline">{label ? `${typeLabel} ${label}` : typeLabel}</span>
            {" "}
            <span className="text-[var(--color-text-secondary)]">{ACTIVITY_KIND_LABELS[item.action].toLowerCase()}</span>
          </span>
          {deleted ? (
            <span className={TOMBSTONE_TAG_CLASS} data-testid="activity-tombstone">{ACTIVITY_DELETED_RECORD_LABEL}</span>
          ) : null}
        </span>
        {summary ? <span className="body-caption text-[var(--color-text-secondary)]">{summary}</span> : null}
        {lines.length > 0 ? (
          <span className="flex min-w-0 flex-col gap-2">
            {lines.map((line) => <FieldChange key={line.key} line={line} />)}
          </span>
        ) : null}
        {item.action === "status_changed" ? (
          <>
            <StatusChange label="Status" from={item.fromStatus} to={item.toStatus} />
            <StatusChange label="Registry status" from={item.fromRemote} to={item.toRemote} />
          </>
        ) : null}
      </span>
      {hideMeta ? (
        // The burst header above carries the visible time and actor; the row keeps them for screen readers.
        <span className="sr-only">
          <time dateTime={item.occurredAt.toISOString()}>{formatDateTime(item.occurredAt)}</time>{" "}
          <span>{activityActorText(actor)}</span>
        </span>
      ) : (
        <span
          className={cn(
            "col-start-2 flex flex-wrap items-baseline gap-x-8 body-caption text-[var(--color-text-tertiary)]",
            "@min-[34rem]:col-start-3 @min-[34rem]:row-span-2 @min-[34rem]:row-start-1 @min-[34rem]:flex-col @min-[34rem]:items-end @min-[34rem]:gap-x-0 @min-[34rem]:text-right",
          )}
        >
          <time dateTime={item.occurredAt.toISOString()} title={formatDateTime(item.occurredAt)} className="tabular-nums">
            {showDate ? formatDateTime(item.occurredAt) : formatTime(item.occurredAt)}
          </time>
          <span>
            <span className={cn(!actor.missing && "text-[var(--color-text-secondary)]")}>{actor.name}</span>
            {actor.channel ? ` ${actor.channel}` : null}
          </span>
        </span>
      )}
    </>
  );
}

/** The row turns to three columns once its own box (not the viewport) is 34rem wide. Class names are literal so Tailwind sees them. */
const ROW_CLASS = "grid min-h-44 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-12 gap-y-4 px-8 py-8 @min-[34rem]:grid-cols-[auto_minmax(0,1fr)_auto] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]";

export function ActivityEntry({
  item,
  creditBatchId,
  focusRef,
  showDate = false,
  hideMeta = false,
}: {
  item: ActivityItem;
  creditBatchId: string;
  /** Receives the row's focusable element, so "Show older activity" can move focus to the first new row. */
  focusRef?: (node: HTMLElement | null) => void;
  /** Show the full date with the time, for a list with no day headings above it. */
  showDate?: boolean;
  /** Omit the actor and time, when a cluster header above the row carries them. */
  hideMeta?: boolean;
}) {
  const href = activityRecordHref(item, { creditBatchId });
  return (
    <li data-testid="activity-entry" data-kind={item.action} data-record-type={item.entityType} className="@container relative">
      {href ? (
        <Link
          ref={focusRef}
          href={href}
          className={cn(ROW_CLASS, "group hover:bg-[var(--color-background-light)]")}
        >
          <EntryBody item={item} showDate={showDate} hideMeta={hideMeta} />
        </Link>
      ) : (
        <div
          ref={focusRef}
          // Focusable by script only, so focus can land here after "Show older
          // activity" and stay once the ref moves on.
          tabIndex={-1}
          className={ROW_CLASS}
        >
          <EntryBody item={item} showDate={showDate} hideMeta={hideMeta} />
        </div>
      )}
    </li>
  );
}
