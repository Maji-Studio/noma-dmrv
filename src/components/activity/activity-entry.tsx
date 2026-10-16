"use client";

/**
 * One activity event as one row: kind, record, what changed (one line per
 * field, old value muted, an arrow, the new value), then who and when. A record with a side sheet makes the whole row a link (the sheet's
 * SheetLinkRow shape); a deleted record is a tombstone with no link.
 */
import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { formatDateTime } from "@/lib/format-utils";
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
  activityFieldNameLabels,
  type ActivityFieldLine,
  type ActivityValueText,
} from "./activity-change-lines";
import { ACTIVITY_CREATED_FIELDS_LABEL, ACTIVITY_DELETED_RECORD_LABEL } from "./activity-copy";
// By file, not the barrel: the chain-of-custody barrel imports this folder.
import { ChainStatusBadge } from "@/components/chain-of-custody/chain-status-badge";

const TAG_CLASS = "inline-flex h-[20px] shrink-0 items-center border px-6 body-caption-fit font-medium";
const KIND_TAG_CLASS = `${TAG_CLASS} border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]`;
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

function EntryBody({ item }: { item: ActivityItem }) {
  const typeLabel = activityRecordTypeLabel(item.entityType);
  const label = activityRecordLabel(item);
  const deleted = item.record.deleted;
  const summary = activityChangeSummary(item);
  const lines = activityFieldLines(item);
  // A creation names the fields it recorded; their values are the record itself.
  const created = item.action === "created" ? activityFieldNameLabels(item) : [];
  const actor = activityActorDisplay(item);
  return (
    <span className="flex min-w-0 flex-col gap-4">
      <span className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-4">
        <span className={KIND_TAG_CLASS}>{ACTIVITY_KIND_LABELS[item.action]}</span>
        <span className="min-w-0 body-small text-[var(--color-text-primary)]">
          <span className="text-[var(--color-text-secondary)]">{typeLabel}</span>
          {label ? <span className="ml-6 font-medium group-hover:underline">{label}</span> : null}
        </span>
        {deleted ? (
          <span className={TOMBSTONE_TAG_CLASS} data-testid="activity-tombstone">{ACTIVITY_DELETED_RECORD_LABEL}</span>
        ) : null}
      </span>
      {summary ? <span className="body-caption text-[var(--color-text-secondary)]">{summary}</span> : null}
      {created.length > 0 ? (
        <span className="body-caption text-[var(--color-text-secondary)]">
          {ACTIVITY_CREATED_FIELDS_LABEL}: {created.join(", ")}
        </span>
      ) : null}
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
      <span className="body-caption text-[var(--color-text-tertiary)]">
        <span className={cn(!actor.missing && "text-[var(--color-text-secondary)]")}>{actor.name}</span>
        {actor.channel ? ` ${actor.channel}` : null}
        {" · "}
        <time dateTime={item.occurredAt.toISOString()}>{formatDateTime(item.occurredAt)}</time>
      </span>
    </span>
  );
}

export function ActivityEntry({
  item,
  creditBatchId,
  focusRef,
}: {
  item: ActivityItem;
  creditBatchId: string;
  /** Receives the row's focusable element, so "Show older activity" can move focus to the first new row. */
  focusRef?: (node: HTMLElement | null) => void;
}) {
  const href = activityRecordHref(item, { creditBatchId });
  return (
    <li data-testid="activity-entry" data-kind={item.action} data-record-type={item.entityType}>
      {href ? (
        <Link
          ref={focusRef}
          href={href}
          className="group flex min-h-44 min-w-0 items-center justify-between gap-12 py-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
        >
          <EntryBody item={item} />
          <ArrowRightIcon
            size={14}
            aria-hidden
            className="shrink-0 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-primary)]"
          />
        </Link>
      ) : (
        <div
          ref={focusRef}
          // Focusable by script only, so focus can land here after "Show older
          // activity" and stay once the ref moves on.
          tabIndex={-1}
          className="flex min-h-44 min-w-0 items-center py-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
        >
          <EntryBody item={item} />
        </div>
      )}
    </li>
  );
}
