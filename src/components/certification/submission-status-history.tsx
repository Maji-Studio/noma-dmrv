/**
 * SubmissionStatusHistory
 * The statuses one Removal or GHG Statement went through, newest first: when
 * each began and who changed it. Styled after `SyncEventList`: a ruled,
 * compact timeline. Rendered inside the badge popover
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
      className="flex flex-col gap-12 border-l border-[var(--color-border-secondary)] pl-12"
    >
      {entries.map((entry) => {
        const actor = describeStatusChangeActor(entry);
        return (
          <li key={entry.id} className="flex flex-col gap-4 body-caption">
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
