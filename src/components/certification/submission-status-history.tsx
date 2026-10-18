/**
 * SubmissionStatusHistory
 * The statuses one Removal or GHG Statement went through, newest first: when
 * each began and who changed it. Styled after `SyncEventList`: a ruled,
 * compact timeline with a bubble per entry. Rendered inside the badge popover
 * (`CertificationStatusBadge`), so it mounts, and fetches, on open.
 */
"use client";

import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, Notice, StatusBadge } from "@/components/ui";
import { useSubmissionStatusHistory } from "@/hooks/use-certification";
import type {
  StatusHistoryEntityType,
  SubmissionStatusHistoryEntry,
} from "@/lib/certification/status-history";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate, formatDateTime } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { describeStatusChangeActor } from "./status-change-actor";

const EMPTY_ICON_SIZE = 32;

const RECORD_NAME: Record<StatusHistoryEntityType, string> = {
  removal: "Removal",
  ghg_statement: "GHG Statement",
};

export function SubmissionStatusHistory({
  entityType,
  entityId,
}: {
  entityType: StatusHistoryEntityType;
  entityId: string;
}) {
  const query = useSubmissionStatusHistory(entityType, entityId);

  if (query.isPending) {
    return (
      <p role="status" className="body-small text-[var(--color-text-tertiary)]">
        Loading status history…
      </p>
    );
  }

  if (query.isError) {
    return (
      <Notice
        tone="error"
        action={
          <Button
            variant="default"
            size="small"
            busy={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        }
      >
        The status history could not be loaded.
      </Notice>
    );
  }

  const { entries, recordingBeganAt } = query.data;

  return (
    <div className="flex flex-col gap-12">
      {entries.length === 0 ? (
        <EmptyState
          padding="sm"
          icon={<ClockCounterClockwiseIcon size={EMPTY_ICON_SIZE} />}
          title="No status changes yet"
          description={`Status changes appear here once this ${RECORD_NAME[entityType]} is submitted.`}
        />
      ) : (
        <StatusHistoryList entries={entries} />
      )}
      {recordingBeganAt && (
        <Notice tone="info">
          Recording began on {formatDate(recordingBeganAt)}. Earlier entries do
          not show who made the change.
        </Notice>
      )}
    </div>
  );
}

function StatusHistoryList({ entries }: { entries: SubmissionStatusHistoryEntry[] }) {
  return (
    <ol
      aria-label="Status changes, newest first"
      className="flex flex-col"
    >
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const actor = describeStatusChangeActor(entry);
        return (
          <li
            key={entry.id}
            className={cn("relative flex flex-col gap-4 pl-16 body-caption", !isLast && "pb-12")}
          >
            {/* Timeline: a bubble per entry on a line that runs to the next
                bubble and ends at the last one. The newest bubble is solid. */}
            {!isLast && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-[3px] top-10 w-2 bg-[var(--color-border-secondary)]"
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-0 top-6 size-8 rounded-full border border-[var(--color-text-tertiary)]",
                index === 0
                  ? "bg-[var(--color-text-tertiary)]"
                  : "bg-[var(--color-background-white)]"
              )}
            />
            <div className="flex flex-wrap items-center gap-8">
              <StatusBadge status={entry.value} label={entry.label} size="small" />
              {entry.occurredAt ? (
                <time
                  dateTime={new Date(entry.occurredAt).toISOString()}
                  className="text-[var(--color-text-tertiary)]"
                >
                  {formatDateTime(entry.occurredAt)}
                </time>
              ) : (
                // Changed before recording began, at a time nothing marks.
                <span className="text-[var(--color-text-tertiary)]">
                  {MISSING_VALUE.notAvailable}
                </span>
              )}
            </div>
            <p className="body-caption text-[var(--color-text-secondary)] break-words">
              {actor ? `${actor} · ` : ""}Version {entry.version}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
