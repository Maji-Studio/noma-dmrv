/**
 * GhgStatementCarbonBreakdown — the carbon-accounting roll-up at the top of the
 * GHG-statement detail sheet. A thin wrapper that fetches the statement's
 * exact registry member roll-up. It shows no partial sum or local estimate.
 */
"use client";

import { useGhgStatementBreakdown } from "@/hooks/use-certification";
import { CarbonBreakdownSkeleton } from "./carbon-breakdown";
import { RegistryCarbonResultCard } from "./registry-carbon-result-card";
import { RegistryObservationMessage } from "./removal-carbon-breakdown";

interface GhgStatementCarbonBreakdownProps {
  query: ReturnType<typeof useGhgStatementBreakdown>;
}

export function GhgStatementCarbonBreakdown({
  query,
}: GhgStatementCarbonBreakdownProps) {
  if (query.isLoading) return <CarbonBreakdownSkeleton />;
  if (query.isError || !query.data) {
    return (
      <RegistryObservationMessage
        message="The registry roll-up could not be loaded. Try again."
        onRetry={() => void query.refetch()}
      />
    );
  }
  // "pending" is an expected lifecycle state (Isometric has not finished
  // calculating the members), not a failure: one quiet line, no retry button.
  // Only "unavailable" (a failed registry fetch) earns the retry panel.
  if (query.data.status === "pending") {
    return (
      <p className="body-caption text-[var(--color-text-tertiary)]">
        {query.data.message}
      </p>
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
    <RegistryCarbonResultCard
      data={query.data.value}
      scopeLabel="GHG Statement"
      variant="compact"
    />
  );
}
