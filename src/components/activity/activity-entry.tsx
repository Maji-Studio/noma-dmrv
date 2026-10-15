"use client";

/**
 * One activity event as one row: kind, record, what changed, then who and
 * when. A record with a side sheet makes the whole row a link (the sheet's
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
  activityChangedFieldLabels,
  activityRecordHref,
  activityRecordLabel,
  activityRecordTypeLabel,
  activityStatusLabel,
  type ActivityItem,
} from "./activity-display";
import { ACTIVITY_DELETED_RECORD_LABEL } from "./activity-copy";

const TAG_CLASS = "inline-flex h-[20px] shrink-0 items-center border px-6 body-caption-fit font-medium";
const KIND_TAG_CLASS = `${TAG_CLASS} border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]`;
const TOMBSTONE_TAG_CLASS = `${TAG_CLASS} border-dashed border-[var(--color-border-primary)] text-[var(--color-text-secondary)]`;
const STATUS_CLASS = "inline-flex items-center border border-[var(--color-border-tertiary)] px-6 body-caption-fit";

/** Before and after as two blocks with an arrow between them. */
function StatusChange({ label, from, to }: { label: string; from: string | null; to: string | null }) {
  if (!to) return null;
  return (
    <p className="flex flex-wrap items-center gap-6 body-caption text-[var(--color-text-secondary)]">
      <span>{label}</span>
      {from ? (
        <>
          <span className={STATUS_CLASS}>{activityStatusLabel(from)}</span>
          <ArrowRightIcon size={12} aria-label="to" className="text-[var(--color-text-tertiary)]" />
        </>
      ) : null}
      <span className={STATUS_CLASS}>{activityStatusLabel(to)}</span>
    </p>
  );
}

function EntryBody({ item }: { item: ActivityItem }) {
  const typeLabel = activityRecordTypeLabel(item.entityType);
  const label = activityRecordLabel(item);
  const deleted = item.record.deleted;
  const summary = activityChangeSummary(item);
  // A creation lists every field it set, so only an update names its fields.
  const fields = item.action === "updated" && !summary ? activityChangedFieldLabels(item) : [];
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
      {fields.length > 0 ? (
        <span className="body-caption text-[var(--color-text-secondary)]">Changed: {fields.join(", ")}</span>
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
