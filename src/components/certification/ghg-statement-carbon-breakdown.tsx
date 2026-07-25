/**
 * GhgStatementCarbonBreakdown — the carbon-accounting roll-up at the top of the
 * GHG-statement detail sheet. A thin wrapper that fetches the statement's
 * breakdown (the sum across its member removals) and renders it through the
 * shared `CarbonBreakdownCard`. A draft statement shows an honest local
 * estimate; once every member removal is submitted it shows the registry's
 * verified GHG entries aggregated. See
 * `@/lib/certification/ghg-statement-breakdown` for the aggregation.
 */
"use client";

import { useGhgStatementBreakdown } from "@/hooks/use-certification";
import {
  CarbonBreakdownCard,
  CarbonBreakdownSkeleton,
  type CarbonBreakdownLabels,
} from "./carbon-breakdown";

interface GhgStatementCarbonBreakdownProps {
  ghgStatementId: string;
  /** Gate the fetch — the sheet only enables it while open. */
  enabled?: boolean;
}

const STATEMENT_LABELS: CarbonBreakdownLabels = {
  noData:
    "Carbon figures appear once this statement's removals have complete data.",
  estimateIncomplete:
    "A net estimate needs every member removal's stored-carbon inputs.",
  estimateFootnote:
    "The uncertainty discount and final net are set when Isometric verifies this statement.",
  anomalyDescription:
    "The normal statement roll-up is hidden until the carbon data is corrected.",
};

export function GhgStatementCarbonBreakdown({
  ghgStatementId,
  enabled = true,
}: GhgStatementCarbonBreakdownProps) {
  const { data, isLoading, isError } = useGhgStatementBreakdown(
    ghgStatementId,
    enabled,
  );

  if (isLoading) return <CarbonBreakdownSkeleton />;
  // The roll-up is supplementary — if it can't load, the rest of the detail
  // sheet still does its job, so fail quiet rather than block the view.
  if (isError || !data) return null;

  return <CarbonBreakdownCard data={data} labels={STATEMENT_LABELS} />;
}
