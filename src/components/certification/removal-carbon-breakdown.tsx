/**
 * RemovalCarbonBreakdown — the registry result card in the removal detail
 * sheet. A thin wrapper that fetches Isometric's read-only observation and
 * renders only the fields Isometric returned. No local carbon calculation or
 * reconciliation enters this workflow.
 */
"use client";

import { Button } from "@/components/ui";
import { useRemovalBreakdown } from "@/hooks/use-certification";
import { CarbonBreakdownSkeleton } from "./carbon-breakdown";
import { RegistryCarbonResultCard } from "./registry-carbon-result-card";

interface RemovalCarbonBreakdownProps {
  removalId: string;
  /** Gate the fetch — the sheet only enables it while open. */
  enabled?: boolean;
}

export function RemovalCarbonBreakdown({
  removalId,
  enabled = true,
}: RemovalCarbonBreakdownProps) {
  const query = useRemovalBreakdown(removalId, enabled);

  if (query.isLoading) return <CarbonBreakdownSkeleton />;
  if (query.isError || !query.data) {
    return (
      <RegistryObservationMessage
        message="Couldn’t load the registry carbon result."
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (query.data.status !== "available") {
    return (
      <RegistryObservationMessage
        message={query.data.message}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {query.data.value.durabilityComponent && (
        <div className="border border-[var(--color-border-secondary)] p-12">
          <p className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Durability component
          </p>
          <p className="mt-4 body-small text-[var(--color-text-secondary)]">
            {query.data.value.durabilityComponent.label}
          </p>
          <p className="mt-4 break-all font-mono body-caption text-[var(--color-text-tertiary)]">
            {query.data.value.durabilityComponent.key}
          </p>
        </div>
      )}
      <RegistryCarbonResultCard
        data={query.data.value}
        scopeLabel="Removal"
      />
    </div>
  );
}

export function RegistryObservationMessage({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-8 border border-[var(--color-border-secondary)] p-12">
      <p className="body-small text-[var(--color-text-secondary)]">{message}</p>
      <Button variant="default" size="small" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
