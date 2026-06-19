/**
 * RemovalCarbonBreakdown — the carbon-accounting card in the removal detail
 * sheet. A thin wrapper that fetches the removal's reconciled breakdown and
 * renders it through the shared `CarbonBreakdownCard`; the visual story (the
 * deduction bar, the signed ledger, the states) lives there so this card and
 * the GHG-statement roll-up can't drift. See `@/lib/certification/removal-breakdown`
 * for the math behind the figures.
 */
"use client";

import { Info, Thermometer, Warning } from "@phosphor-icons/react/dist/ssr";
import { StatusBadge } from "@/components/ui/status-badge";
import { useRemovalBreakdown } from "@/hooks/use-certification";
import type { ConservativeSoilTemperature } from "@/lib/isometric/utils/durability-aggregation";
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

/**
 * The conservative soil-temperature estimate that drives the 200-year durable
 * fraction, surfaced explicitly as an approximation (decision D2 soil-temp
 * resolution): the registry computes F_durable from soil temperature + H/C_org,
 * and noma submits the MAX site temperature (7 °C floor) in lieu of a measured
 * project-area annual average. Shown here so the figure is never mistaken for a
 * monitored value. Lives in the removal-specific wrapper, not the shared
 * `CarbonBreakdownCard`, since the GHG-statement roll-up has no single site temp.
 */
function SoilTemperatureNote({ soil }: { soil: ConservativeSoilTemperature }) {
  return (
    <div className="flex flex-col gap-8 border border-[var(--color-border-primary)] p-12">
      <div className="flex items-center justify-between gap-12">
        <span className="flex items-center gap-6 body-small text-[var(--color-text-primary)]">
          <Thermometer
            size={16}
            weight="bold"
            aria-hidden
            className="text-[var(--color-text-secondary)]"
          />
          Durability soil temperature
        </span>
        <span className="flex items-center gap-8">
          {soil.effectiveSoilTemperatureC != null && (
            <span className="body-small font-medium text-[var(--color-text-primary)]">
              {soil.effectiveSoilTemperatureC.toFixed(1)} °C
            </span>
          )}
          <StatusBadge status="draft" label="Conservative estimate" size="small" />
        </span>
      </div>
      <p className="flex items-start gap-6 body-caption text-[var(--color-text-tertiary)]">
        <Info size={13} weight="fill" aria-hidden className="mt-2 shrink-0" />
        <span>{soil.method}</span>
      </p>
      {soil.warnings.map((warning) => (
        <p
          key={warning}
          className="flex items-start gap-6 body-caption text-[var(--color-text-secondary)]"
        >
          <Warning
            size={13}
            weight="fill"
            aria-hidden
            className="mt-2 shrink-0 text-[var(--color-signal-orange)]"
          />
          <span>{warning}</span>
        </p>
      ))}
    </div>
  );
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

  return (
    <div className="flex flex-col gap-16">
      <CarbonBreakdownCard data={data} labels={REMOVAL_LABELS} />
      {data.soilTemperature && (
        <SoilTemperatureNote soil={data.soilTemperature} />
      )}
    </div>
  );
}
