/**
 * FacilityActivity: where the facility's energy went over a period, and which
 * records used it (ADR 0031). It sits behind the "Facility activity"
 * disclosure on the Emissions overview. One toolbar (period, credit batch),
 * one summary line, then the ranked record list and the totals panel.
 * Recorded activity only (litres, kWh, tonne-km); no CO2e is shown.
 *
 * The period and the credit batch live in the URL (`activityPeriod`,
 * `activityBatch`, #841) next to the overview's own keys.
 */
"use client";

import { useState } from "react";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { ServerError } from "@/components/forms";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useEnergyBreakdown } from "@/hooks/use-energy";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { formatFacilityDate } from "@/lib/date-utils";
import {
  DEFAULT_ENERGY_PERIOD_PRESET,
  ENERGY_PERIOD_PRESETS,
  energyPresetPeriod,
  type EnergyPeriodPreset,
} from "@/lib/energy/period";
import {
  batchReachesPeriod,
  creditBatchOptions,
  flowsForBatch,
  gapsForBatch,
  recordsForBatch,
  resolveSelectedBatch,
  totalsBySource,
} from "@/lib/energy/selection";
import type { EnergyRecordScope } from "@/lib/energy/types";
import { formatDateRange } from "@/lib/format-utils";
import { EnergyActivityPanel } from "./energy-activity-panel";
import { EnergyRecordList } from "./energy-record-list";
import { EnergySummaryLine } from "./energy-summary-line";
import { EnergyToolbar } from "./energy-toolbar";

const LOADING_PANEL_CLASS = "h-320 w-full";
const PRESET_KEYS = ENERGY_PERIOD_PRESETS.map((preset) => preset.key);

const activityParsers = {
  activityPeriod: parseAsStringLiteral(PRESET_KEYS).withDefault(DEFAULT_ENERGY_PERIOD_PRESET),
  activityBatch: parseAsString,
};

interface FacilityActivityProps {
  facilityId: string;
  /** One line under the summary, e.g. what the totals include. */
  caption?: string;
}

export function FacilityActivity({ facilityId, caption }: FacilityActivityProps) {
  const { timeZone } = useFacilityClock(facilityId);
  const [{ activityPeriod: preset, activityBatch: requestedBatchId }, setActivity] = useQueryStates(
    activityParsers,
    { history: "replace", scroll: false },
  );
  const [scope, setScope] = useState<EnergyRecordScope>("batch");

  const today = formatFacilityDate(new Date(), timeZone);
  const period = energyPresetPeriod(preset, today);
  const { data, isLoading, error } = useEnergyBreakdown({ facilityId, from: period.from, to: period.to });

  if (error && !data) {
    return (
      <ServerError
        message={error.message || "The activity figures could not be loaded. Refresh the page and try again."}
      />
    );
  }

  const resolvedPeriod = { from: data?.from ?? period.from, to: period.to };
  const selectedBatch = resolveSelectedBatch(
    data?.creditBatches ?? [],
    resolvedPeriod,
    data?.flows ?? [],
    requestedBatchId,
  );
  const batchOptions = creditBatchOptions(data?.creditBatches ?? [], resolvedPeriod, data?.flows ?? []);
  const batchId = selectedBatch?.id ?? null;
  const periodText = resolvedPeriod.from ? formatDateRange(resolvedPeriod.from, resolvedPeriod.to) : "";

  const changePreset = (next: EnergyPeriodPreset) => {
    const nextPeriod = energyPresetPeriod(next, today);
    const stillInPeriod = (data?.creditBatches ?? []).some(
      (batch) => batch.id === requestedBatchId && batchReachesPeriod(batch, nextPeriod, data?.flows ?? []),
    );
    void setActivity({
      activityPeriod: next === DEFAULT_ENERGY_PERIOD_PRESET ? null : next,
      ...(stillInPeriod ? {} : { activityBatch: null }),
    });
  };

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-col gap-12">
        <EnergyToolbar
          preset={preset}
          onPresetChange={changePreset}
          creditBatches={batchOptions}
          batchId={batchId}
          onBatchChange={(next) => void setActivity({ activityBatch: next })}
        />
        {data ? (
          <EnergySummaryLine
            flows={flowsForBatch(data.flows, batchId)}
            gaps={gapsForBatch(data.gaps, batchId)}
            batch={selectedBatch}
            periodText={periodText}
          />
        ) : (
          <Skeleton className="h-20 w-[320px] max-w-full" />
        )}
        {caption && <p className="body-caption text-[var(--color-text-tertiary)]">{caption}</p>}
      </div>

      {isLoading || !data ? (
        <Skeleton className={LOADING_PANEL_CLASS} />
      ) : (
        <div className="flex flex-col gap-24 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <EnergyRecordList
              records={recordsForBatch(data.records, batchId)}
              creditBatches={data.creditBatches}
              facilityId={facilityId}
              scope={scope}
              onScopeChange={setScope}
            />
          </div>
          <div className="lg:w-[320px] lg:shrink-0">
            <EnergyActivityPanel
              title={selectedBatch ? selectedBatch.code : "Whole facility"}
              caption={
                selectedBatch
                  ? `Produced ${formatDateRange(selectedBatch.startDate, selectedBatch.endDate)}. Counted within ${periodText}.`
                  : periodText
              }
              totals={totalsBySource(flowsForBatch(data.flows, batchId), gapsForBatch(data.gaps, batchId))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
