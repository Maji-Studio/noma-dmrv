"use client";

import { ServerError } from "@/components/forms";
import { useTransportLegsForEntity } from "@/hooks/use-transport-legs";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import { TransportLegLine } from "./transport-leg-list-item";

interface TransportLegsSummaryProps {
  entityType: TransportEntityTypeValue;
  entityId: string;
  /** Override the section title. Defaults based on entityType. */
  title?: string;
}

const DEFAULT_TITLES: Record<TransportEntityTypeValue, string> = {
  feedstock: "Transport: feedstock → processing",
  biochar: "Transport: biochar → storage",
  sample: "Transport: sample → lab",
  delivery: "Transport legs",
};

/** Read-only transport-leg list for the side-sheet view mode. */
export function TransportLegsSummary({
  entityType,
  entityId,
  title,
}: TransportLegsSummaryProps) {
  const { data: legs, isLoading, error } = useTransportLegsForEntity(
    entityType,
    entityId,
  );

  return (
    <section className="flex flex-col gap-12 border border-[var(--color-border-secondary)] p-16">
      <h3 className="title-heading-3">{title ?? DEFAULT_TITLES[entityType]}</h3>

      {error && (
        <ServerError
          message={
            error instanceof Error
              ? error.message
              : "Failed to load transport legs"
          }
        />
      )}

      {error ? null : isLoading ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          Loading transport legs…
        </p>
      ) : !legs || legs.length === 0 ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          No transport legs recorded yet. Use Edit to add one.
        </p>
      ) : (
        <ul className="flex flex-col gap-8">
          {legs.map((leg) => (
            <li
              key={leg.id}
              className="border border-[var(--color-border-secondary)] p-12"
            >
              <TransportLegLine leg={leg} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
