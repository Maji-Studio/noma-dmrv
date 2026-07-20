/**
 * SyncEventLog
 * Append-only log of recent HTTP attempts against Certify. Two variants:
 *
 * - default ("relaxed"): full table view used at the bottom of a section.
 * - "compact": inline timeline used directly under a single submission row,
 *   so the failure context lives next to the thing that failed.
 *
 * Terminal events only (no `pending` rows are written).
 */
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import type { CertifierSyncEventRow } from "@/data-access/certification";
import { formatDateTime } from "@/lib/format-utils";

const COMPACT_DEFAULT_LIMIT = 5;

interface SyncEventLogProps {
  events: CertifierSyncEventRow[];
  /** Compact variant for inline per-submission display. */
  compact?: boolean;
  /** Cap rows when compact. */
  limit?: number;
  /** Override the disclosure label. */
  label?: string;
}

export function SyncEventLog({
  events,
  compact = false,
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

  const visible = compact
    ? events.slice(0, limit ?? COMPACT_DEFAULT_LIMIT)
    : events;
  const triggerLabel =
    label ??
    (compact
      ? `View attempt history (${events.length})`
      : `Recent attempts (${events.length})`);

  if (compact) {
    return (
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-6 list-none [&::-webkit-details-marker]:hidden body-caption text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
          <CaretDownIcon
            size={10}
            weight="bold"
            className="transition-transform duration-150 group-open:rotate-180"
          />
          <span className="underline underline-offset-2">{triggerLabel}</span>
        </summary>
        <ol className="mt-8 flex flex-col gap-6 border-l border-[var(--color-border-secondary)] pl-12">
          {visible.map((event) => (
            <li
              key={event.id}
              className="flex flex-col gap-2 body-caption"
            >
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
      </details>
    );
  }

  return (
    <details className="group">
      <summary className="flex cursor-pointer items-center gap-8 list-none [&::-webkit-details-marker]:hidden body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
        {triggerLabel}
        <CaretDownIcon
          size={12}
          weight="bold"
          className="transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      <div className="mt-12 overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--color-border-secondary)]">
            <Th>Time</Th>
            <Th>Operation</Th>
            <Th>Status</Th>
            <Th>Detail</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((event) => (
            <tr
              key={event.id}
              className="border-b border-[var(--color-border-secondary)] last:border-b-0"
            >
              <Td className="font-mono text-[11px]">
                {formatDateTime(event.attemptedAt)}
              </Td>
              <Td className="font-mono text-[11px]">{event.operation}</Td>
              <Td>
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
              </Td>
              <Td className="text-[var(--color-text-secondary)]">
                {event.errorMessage ?? ""}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </details>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)] py-8 pr-12 font-normal">
      {children}
    </th>
  );
}
function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={`body-small py-8 pr-12 align-top ${className ?? ""}`.trim()}
    >
      {children}
    </td>
  );
}
