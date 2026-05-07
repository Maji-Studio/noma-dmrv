/**
 * SyncEventLog
 * Append-only log of the last N HTTP attempts against Certify for a
 * credit batch. Terminal events only (no `pending` rows are written).
 */
import { CaretDown } from "@phosphor-icons/react";
import type { CertifierSyncEventRow } from "@/data-access/certification";

interface SyncEventLogProps {
  events: CertifierSyncEventRow[];
}

export function SyncEventLog({ events }: SyncEventLogProps) {
  if (events.length === 0) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        No submission attempts yet.
      </p>
    );
  }
  return (
    <details className="group">
      <summary className="flex cursor-pointer items-center gap-8 list-none [&::-webkit-details-marker]:hidden body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
        Recent attempts ({events.length})
        <CaretDown
          size={12}
          weight="bold"
          className="transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      <table className="mt-12 w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--color-border-secondary)]">
            <Th>Time</Th>
            <Th>Operation</Th>
            <Th>Status</Th>
            <Th>Detail</Th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.id}
              className="border-b border-[var(--color-border-secondary)] last:border-b-0"
            >
              <Td className="font-mono text-[11px]">
                {new Date(event.attemptedAt).toLocaleString()}
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
