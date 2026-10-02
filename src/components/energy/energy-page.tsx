/**
 * EnergyPage: where the facility's energy went over a period, and which
 * records used it (ADR 0031). One toolbar (List or Flow, period, credit
 * batch), one summary line, then either the ranked record list or the
 * Sankey. CO2e figures are estimates from the facility's emission factors;
 * without factors the page shows recorded activity only.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { ServerError } from "@/components/forms";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { Notice, PageHeader } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useEnergyBreakdown } from "@/hooks/use-energy";
import { useFacilityClock, useFacilityContext } from "@/hooks/use-facility-context";
import { certificationEmissionFactorsHref } from "@/lib/certification/links";
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
import { EnergyFlow } from "./energy-flow";
import { EnergyRecordList } from "./energy-record-list";
import { EnergySummaryLine } from "./energy-summary-line";
import { EnergyToolbar, type EnergyView } from "./energy-toolbar";

const SUBTITLE = "Where the facility's energy went, and which records used it.";
const LOADING_PANEL_CLASS = "h-320 w-full";

export function EnergyPage() {
  const { facilityId } = useFacilityContext();
  const { timeZone } = useFacilityClock(facilityId);
  const [view, setView] = useState<EnergyView>("list");
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
  const hasFactors = data?.factors != null;

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

      {data && !hasFactors && (
        <Notice
          tone="info"
          title="No emission factors set for this facility."
          action={
            data.viewerCanManage ? (
              <Link
                href={certificationEmissionFactorsHref(facilityId)}
                className="body-small font-medium text-[var(--color-interaction)] underline underline-offset-4"
              >
                Set emission factors
              </Link>
            ) : undefined
          }
        >
          {data.viewerCanManage
            ? "Figures show recorded activity only. Set the factors to see estimated CO₂e."
            : "Figures show recorded activity only. Ask an Owner or Admin to set the factors."}
        </Notice>
      )}

      <div className="flex flex-col gap-12">
        <EnergyToolbar
          view={view}
          onViewChange={setView}
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
            production={data.production}
            batch={selectedBatch}
            periodText={periodText}
            hasFactors={hasFactors}
          />
        ) : (
          <Skeleton className="h-20 w-[320px] max-w-full" />
        )}
      </div>

      {isLoading || !data ? (
        <Skeleton className={LOADING_PANEL_CLASS} />
      ) : view === "flow" ? (
        <EnergyFlow
          flows={data.flows}
          scopedFlows={flowsForBatch(data.flows, batchId)}
          scopedGaps={gapsForBatch(data.gaps, batchId)}
          creditBatches={data.creditBatches}
          selectedBatch={selectedBatch}
          periodText={periodText}
          hasFactors={hasFactors}
          onSelectBatch={setRequestedBatchId}
        />
      ) : (
        <EnergyRecordList
          records={recordsForBatch(data.records, batchId)}
          creditBatches={data.creditBatches}
          facilityId={facilityId}
          hasFactors={hasFactors}
          scope={scope}
          onScopeChange={setScope}
        />
      )}
    </div>
  );
}
