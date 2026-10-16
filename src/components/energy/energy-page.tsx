/**
 * EnergyPage: where the facility's energy went over a period, and which
 * records used it (ADR 0031). One toolbar (period, credit batch), one summary
 * line, then the ranked record list. Recorded activity only (litres, kWh,
 * tonne-km); no CO2e is shown.
 */
"use client";

import { useState } from "react";
import { ServerError } from "@/components/forms";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { PageHeader } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useEnergyBreakdown } from "@/hooks/use-energy";
import { useFacilityClock, useFacilityContext } from "@/hooks/use-facility-context";
import { formatFacilityDate } from "@/lib/date-utils";
import {
  DEFAULT_ENERGY_PERIOD_PRESET,
  creditBatchInPeriod,
  energyPresetPeriod,
  type EnergyPeriodPreset,
} from "@/lib/energy/period";
import {
  creditBatchOptions,
  flowsForBatch,
  gapsForBatch,
  recordsForBatch,
  resolveSelectedBatch,
} from "@/lib/energy/selection";
import type { EnergyRecordScope } from "@/lib/energy/types";
import { formatDateRange } from "@/lib/format-utils";
import { EnergyRecordList } from "./energy-record-list";
import { EnergySummaryLine } from "./energy-summary-line";
import { EnergyToolbar } from "./energy-toolbar";

const SUBTITLE = "Where the facility's energy went, and which records used it.";
const LOADING_PANEL_CLASS = "h-320 w-full";

export function EnergyPage() {
  const { facilityId } = useFacilityContext();
  const { timeZone } = useFacilityClock(facilityId);
  const [preset, setPreset] = useState<EnergyPeriodPreset>(DEFAULT_ENERGY_PERIOD_PRESET);
  const [requestedBatchId, setRequestedBatchId] = useState<string | null>(null);
  const [scope, setScope] = useState<EnergyRecordScope>("batch");

  const today = formatFacilityDate(new Date(), timeZone);
  const period = energyPresetPeriod(preset, today);
  const { data, isLoading, error } = useEnergyBreakdown(
    facilityId ? { facilityId, from: period.from, to: period.to } : null,
  );

  if (!facilityId) {
    return (
      <div className="container-max page-shell">
        <PageHeader area="infrastructure" title="Energy" subtitle={SUBTITLE} />
        <SelectFacilityEmptyState description="Choose a facility from the sidebar to see its energy use." />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="container-max py-32">
        <ServerError
          message={
            error.message || "The energy figures could not be loaded. Refresh the page and try again."
          }
        />
      </div>
    );
  }

  const resolvedPeriod = { from: data?.from ?? period.from, to: period.to };
  const selectedBatch = resolveSelectedBatch(
    data?.creditBatches ?? [],
    resolvedPeriod,
    data?.flows ?? [],
    requestedBatchId,
  );
  const batchOptions = creditBatchOptions(data?.creditBatches ?? [], resolvedPeriod, selectedBatch);
  const batchId = selectedBatch?.id ?? null;
  const periodText = resolvedPeriod.from
    ? formatDateRange(resolvedPeriod.from, resolvedPeriod.to)
    : "";

  const changePreset = (next: EnergyPeriodPreset) => {
    setPreset(next);
    const nextPeriod = energyPresetPeriod(next, today);
    const stillInPeriod = (data?.creditBatches ?? []).some(
      (batch) => batch.id === requestedBatchId && creditBatchInPeriod(batch, nextPeriod),
    );
    if (!stillInPeriod) setRequestedBatchId(null);
  };

  return (
    <div className="container-max page-shell">
      <PageHeader area="infrastructure" title="Energy" subtitle={SUBTITLE} />

      <div className="flex flex-col gap-12">
        <EnergyToolbar
          preset={preset}
          onPresetChange={changePreset}
          creditBatches={batchOptions}
          batchId={batchId}
          onBatchChange={setRequestedBatchId}
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
      </div>

      {isLoading || !data ? (
        <Skeleton className={LOADING_PANEL_CLASS} />
      ) : (
        <EnergyRecordList
          records={recordsForBatch(data.records, batchId)}
          creditBatches={data.creditBatches}
          facilityId={facilityId}
          scope={scope}
          onScopeChange={setScope}
        />
      )}
    </div>
  );
}
