/**
 * EnergyToolbar: the period and the credit batch filter. The
 * batch select lists the batches whose dates overlap the period or whose
 * energy reaches it, newest first, grouped by year.
 */
"use client";

import { DataTable } from "@/components/ui";
import {
  ENERGY_PERIOD_PRESETS,
  isEnergyPeriodPreset,
  type EnergyPeriodPreset,
} from "@/lib/energy/period";
import type { EnergyCreditBatchInput } from "@/lib/energy/types";

/** Select value for "no credit batch filter". */
export const ALL_CREDIT_BATCHES = "all";

interface EnergyToolbarProps {
  preset: EnergyPeriodPreset;
  onPresetChange: (preset: EnergyPeriodPreset) => void;
  /** Credit batches whose dates overlap the period or whose energy reaches it. */
  creditBatches: EnergyCreditBatchInput[];
  batchId: string | null;
  onBatchChange: (batchId: string | null) => void;
}

export function EnergyToolbar({
  preset,
  onPresetChange,
  creditBatches,
  batchId,
  onBatchChange,
}: EnergyToolbarProps) {
  const newestFirst = [...creditBatches].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const years = [...new Set(newestFirst.map((batch) => batch.startDate.slice(0, 4)))];

  return (
    <div className="flex flex-col gap-12 sm:flex-row sm:items-center">
      <DataTable.FilterSelect
        aria-label="Period"
        value={preset}
        onChange={(event) => {
          if (isEnergyPeriodPreset(event.target.value)) onPresetChange(event.target.value);
        }}
      >
        {ENERGY_PERIOD_PRESETS.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </DataTable.FilterSelect>
      <DataTable.FilterSelect
        aria-label="Credit batch"
        value={batchId ?? ALL_CREDIT_BATCHES}
        onChange={(event) =>
          onBatchChange(event.target.value === ALL_CREDIT_BATCHES ? null : event.target.value)
        }
      >
        <option value={ALL_CREDIT_BATCHES}>All credit batches</option>
        {years.map((year) => (
          <optgroup key={year} label={year}>
            {newestFirst
              .filter((batch) => batch.startDate.startsWith(year))
              .map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code}
                </option>
              ))}
          </optgroup>
        ))}
      </DataTable.FilterSelect>
    </div>
  );
}
