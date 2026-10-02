/**
 * EnergyToolbar: List or Flow, the period, and the credit batch filter. The
 * batch select lists only the batches whose dates overlap the period,
 * newest first, grouped by year.
 */
"use client";

import { FlowArrowIcon, ListBulletsIcon } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui";
import {
  ENERGY_PERIOD_PRESETS,
  isEnergyPeriodPreset,
  type EnergyPeriodPreset,
} from "@/lib/energy/period";
import type { EnergyCreditBatchInput } from "@/lib/energy/types";
import { cn } from "@/lib/utils";

export type EnergyView = "list" | "flow";

/** Select value for "no credit batch filter". */
export const ALL_CREDIT_BATCHES = "all";

const VIEWS: { key: EnergyView; label: string; icon: Icon }[] = [
  { key: "list", label: "List", icon: ListBulletsIcon },
  { key: "flow", label: "Flow", icon: FlowArrowIcon },
];

interface EnergyToolbarProps {
  view: EnergyView;
  onViewChange: (view: EnergyView) => void;
  preset: EnergyPeriodPreset;
  onPresetChange: (preset: EnergyPeriodPreset) => void;
  /** Credit batches in the period. */
  creditBatches: EnergyCreditBatchInput[];
  batchId: string | null;
  onBatchChange: (batchId: string | null) => void;
}

export function EnergyToolbar({
  view,
  onViewChange,
  preset,
  onPresetChange,
  creditBatches,
  batchId,
  onBatchChange,
}: EnergyToolbarProps) {
  const newestFirst = [...creditBatches].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const years = [...new Set(newestFirst.map((batch) => batch.startDate.slice(0, 4)))];

  return (
    <div className="flex flex-wrap items-center gap-12">
      <div
        role="group"
        aria-label="View"
        className="flex bg-[var(--panel-bg)] [border:var(--panel-border)]"
      >
        {VIEWS.map(({ key, label, icon: ViewIcon }) => (
          <button
            key={key}
            type="button"
            aria-pressed={view === key}
            onClick={() => onViewChange(key)}
            className={cn(
              "flex h-40 items-center gap-8 px-16 body-small font-medium",
              view === key
                ? "bg-[var(--color-interaction)] text-[var(--color-text-white-primary)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
          >
            <ViewIcon size={16} weight="bold" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex w-full flex-col gap-12 sm:ml-auto sm:w-auto sm:flex-row sm:items-center">
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
    </div>
  );
}
