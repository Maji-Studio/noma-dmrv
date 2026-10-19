/**
 * EnergySummaryLine: one sentence under the toolbar that reads out the
 * recorded activity in its own units (litres, kWh, tonne-km).
 */
import { formatCount } from "@/lib/copy-utils";
import { totalsBySource } from "@/lib/energy/selection";
import { DIESEL_SOURCE_KEYS } from "@/lib/energy/sources";
import type { EnergyCreditBatchInput, EnergyFlow, EnergyGap } from "@/lib/energy/types";
import { formatActivity } from "./energy-display";

interface EnergySummaryLineProps {
  flows: EnergyFlow[];
  gaps: EnergyGap[];
  batch: EnergyCreditBatchInput | null;
  periodText: string;
}

export function EnergySummaryLine({ flows, gaps, batch, periodText }: EnergySummaryLineProps) {
  const where = `from ${periodText}${batch ? ` in ${batch.code}` : ""}`;
  const missing = gaps.length > 0 ? `, ${formatCount(gaps.length, "missing reading")}` : "";
  const totals = totalsBySource(flows, gaps);
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
