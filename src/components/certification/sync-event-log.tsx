/**
 * SyncEventLog
 * Append-only log of recent HTTP attempts against Certify: an inline timeline
 * used directly under a single submission row, so the failure context lives
 * next to the thing that failed.
 *
 * Terminal events only (no `pending` rows are written).
 */
import type { CertifierSyncEventRow } from "@/data-access/certification";
import { formatDateTime } from "@/lib/format-utils";
import { DisclosureSummary } from "./disclosure-summary";

const COMPACT_DEFAULT_LIMIT = 5;

interface SyncEventLogProps {
  events: CertifierSyncEventRow[];
  /** Cap rows. */
  limit?: number;
  /** Override the disclosure label. */
  label?: string;
}

export function SyncEventLog({
  events,
  limit,
  label,
}: SyncEventLogProps) {
  if (events.length === 0) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        No submission attempts yet.
      </p>
    );
  }

  const visible = events.slice(0, limit ?? COMPACT_DEFAULT_LIMIT);
  const triggerLabel = label ?? `View attempt history (${events.length})`;

  return (
    <details className="group">
      <DisclosureSummary>{triggerLabel}</DisclosureSummary>
      <div className="mt-8">
        <SyncEventList events={visible} />
      </div>
    </details>
  );
}

/**
 * The bare compact event list, for surfaces that already provide their own
 * disclosure (the GHG statement sheet's history accordion). `SyncEventLog`
 * wraps this in a `<details>`.
 */
export function SyncEventList({ events }: { events: CertifierSyncEventRow[] }) {
  return (
    <ol className="flex flex-col gap-6 border-l border-[var(--color-border-secondary)] pl-12">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-2 body-caption">
          <div className="flex items-center gap-8">
            <span
              className={
                event.status === "succeeded"
                  ? "text-[var(--color-status-success)]"
                  : event.status === "failed"
                    ? "text-[var(--clr-red)]"
                    : "text-[var(--color-text-tertiary)]"
              }
            >
              {event.status}
            </span>
            <span className="font-mono text-[var(--color-text-tertiary)]">
              {event.operation}
            </span>
            <span className="text-[var(--color-text-tertiary)]">
              {formatDateTime(event.attemptedAt)}
            </span>
          </div>
          {event.errorMessage && (
            <p className="body-caption text-[var(--color-text-secondary)] pl-2 break-words">
              {event.errorMessage}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
