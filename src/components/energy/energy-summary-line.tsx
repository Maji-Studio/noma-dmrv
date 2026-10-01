/**
 * EnergySummaryLine: one sentence under the toolbar. With factors it leads
 * with the estimated total and the intensity per dry tonne produced; without
 * them it reads out the recorded activity in its own units.
 */
import { formatCount } from "@/lib/copy-utils";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { producedDryKg, totalKg, totalsBySource } from "@/lib/energy/selection";
import { DIESEL_SOURCE_KEYS } from "@/lib/energy/sources";
import type {
  EnergyCreditBatchInput,
  EnergyFlow,
  EnergyGap,
  EnergyProduction,
} from "@/lib/energy/types";
import { formatActivity, formatEstimate } from "./energy-display";

interface EnergySummaryLineProps {
  flows: EnergyFlow[];
  gaps: EnergyGap[];
  production: EnergyProduction[];
  batch: EnergyCreditBatchInput | null;
  periodText: string;
  hasFactors: boolean;
}

export function EnergySummaryLine({
  flows,
  gaps,
  production,
  batch,
  periodText,
  hasFactors,
}: EnergySummaryLineProps) {
  const where = `from ${periodText}${batch ? ` in ${batch.code}` : ""}`;
  const missing = gaps.length > 0 ? `, ${formatCount(gaps.length, "missing reading")}` : "";

  if (hasFactors) {
    const kg = totalKg(flows);
    const producedTonnes = kgToTonnes(producedDryKg(production, batch?.id ?? null));
    const intensity =
      producedTonnes > 0
        ? `, ${Math.round(kg / producedTonnes).toLocaleString()} kg CO₂e per dry tonne produced`
        : "";
    return (
      <p className="body-small text-[var(--color-text-secondary)]">
        <span className="font-medium text-[var(--color-text-primary)]">{formatEstimate(kg)}</span>{" "}
        {where}
        {intensity}
        {missing}
      </p>
    );
  }

  const totals = totalsBySource(flows, gaps, false);
  const diesel = DIESEL_SOURCE_KEYS.reduce((sum, key) => sum + totals[key].activity, 0);
  const transport = totals.feedstockTransport.activity + totals.biocharTransport.activity;
  return (
    <p className="body-small text-[var(--color-text-secondary)]">
      <span className="font-medium text-[var(--color-text-primary)]">
        {formatActivity(diesel, "L")} diesel
      </span>
      , {formatActivity(totals.grid.activity, "kWh")} grid electricity and{" "}
      {formatActivity(transport, "t·km")} transport {where}
      {missing}
    </p>
  );
}
