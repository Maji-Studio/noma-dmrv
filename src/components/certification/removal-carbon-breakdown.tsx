/**
 * RemovalCarbonBreakdown — the carbon-accounting card in the removal detail
 * sheet. A thin wrapper that fetches the removal's reconciled breakdown and
 * renders it through the shared `CarbonBreakdownCard`; the visual story (the
 * deduction bar, the signed ledger, the states) lives there so this card and
 * the GHG-statement roll-up can't drift. See `@/lib/certification/removal-breakdown`
 * for the math behind the figures.
 */
"use client";

import { useRemovalBreakdown } from "@/hooks/use-certification";
import {
  CarbonBreakdownCard,
  CarbonBreakdownSkeleton,
  type CarbonBreakdownLabels,
} from "./carbon-breakdown";

interface RemovalCarbonBreakdownProps {
  removalId: string;
  /** Gate the fetch — the sheet only enables it while open. */
  enabled?: boolean;
}

const REMOVAL_LABELS: CarbonBreakdownLabels = {
  noData:
    "Carbon figures appear once this removal's credit batches have complete data.",
  estimateIncomplete:
    "A net estimate needs every member batch's stored-carbon inputs.",
  estimateFootnote:
    "The uncertainty discount and final net are set when Isometric verifies this removal.",
};

export function RemovalCarbonBreakdown({
  removalId,
  enabled = true,
}: RemovalCarbonBreakdownProps) {
  const { data, isLoading, isError } = useRemovalBreakdown(removalId, enabled);

  if (isLoading) return <CarbonBreakdownSkeleton />;
  // A breakdown is supplementary — if it can't load, the sheet's other
  // sections still do their job, so fail quiet rather than block the view.
  if (isError || !data) return null;

  return <CarbonBreakdownCard data={data} labels={REMOVAL_LABELS} />;
}
