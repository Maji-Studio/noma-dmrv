/**
 * EnergySummary
 * Read-only facility rollup of electricity + diesel across production runs,
 * plus a preview of the combined energy datapoints submitted to Isometric
 * (ADR 0014 — one grid-electricity + one genset measurement point, no per-stage
 * split). Startup/plant diesel is shown but not submitted under the active
 * template, which declares no fuel-usage component to carry it.
 */
"use client";

import { Fire, GasPump, Lightning } from "@phosphor-icons/react";
import { ServerError } from "@/components/forms";
import { EmptyState, PageHeader } from "@/components/ui";
import { StatCard } from "@/components/ui/stat-card";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFacilityEnergyTotals } from "@/hooks/use-production-runs";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";

function fmt(value: number): string {
  return Math.round(value).toLocaleString();
}

export function EnergySummary() {
  const { facilityId } = useFacilityContext();
  const { data: totals, isLoading, error: totalsError } = useFacilityEnergyTotals(
    facilityId ?? "",
    !!facilityId,
  );
  const { data: certifierSummary, isLoading: mappingLoading, error: mappingError } =
    useFacilityCertifierSummary(
      facilityId ?? "",
      !!facilityId,
    );

  const electricityKwh = totals?.electricityKwh ?? 0;
  const gensetLitres = totals?.gensetLitres ?? 0;
  const startupLitres = totals?.startupLitres ?? 0;
  const runCount = totals?.runCount ?? 0;

  const config = certifierSummary?.mapping ?? null;
  const yieldKwhPerL = config?.gensetEnergyYieldKwhPerLitre ?? null;
  const gensetKwh = yieldKwhPerL != null ? gensetLitres * yieldKwhPerL : null;

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-32">
        <PageHeader
          area="infrastructure"
          title="Energy"
          subtitle="Facility energy use feeding Isometric submission datapoints"
        />
        <EmptyState
          padding="md"
          icon={<Lightning size={48} />}
          title="Select a facility"
          description="Choose a facility from the sidebar to view its energy summary"
        />
      </div>
    );
  }

  if (totalsError && !totals) {
    return (
      <div className="flex flex-col gap-32">
        <PageHeader
          area="infrastructure"
          title="Energy"
          subtitle="Energy totals could not be loaded for this facility."
        />
        <ServerError
          message={
            totalsError instanceof Error
              ? totalsError.message
              : "Failed to load energy totals"
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-32">
      <PageHeader
        area="infrastructure"
        title="Energy"
        subtitle="Facility energy use feeding Isometric submission datapoints"
      />

      {totalsError && (
        <ServerError
          message={
            totalsError instanceof Error
              ? totalsError.message
              : "Failed to refresh energy totals — showing the last loaded figures."
          }
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-24">
        <StatCard
          title="Production Runs"
          value={runCount}
          icon={<Fire size={24} weight="bold" />}
          description="Rolled up in this summary"
          isLoading={isLoading}
        />
        <StatCard
          title="Grid Electricity"
          value={`${fmt(electricityKwh)} kWh`}
          icon={<Lightning size={24} weight="bold" />}
          description="All production runs"
          isLoading={isLoading}
        />
        <StatCard
          title="Genset Diesel"
          value={`${fmt(gensetLitres)} L`}
          icon={<GasPump size={24} weight="bold" />}
          description="All production runs"
          isLoading={isLoading}
        />
        <StatCard
          title="Startup / Plant Diesel"
          value={`${fmt(startupLitres)} L`}
          icon={<GasPump size={24} weight="bold" />}
          description="All production runs"
          isLoading={isLoading}
        />
      </div>

      <div className="flex flex-col gap-12">
        <h2 className="title-heading-3">Submission preview</h2>
        <p className="body-small text-[var(--color-text-secondary)]">
          Energy submits as a single combined measurement point — one grid
          electricity datapoint and one diesel-genset datapoint (genset litres ×
          the facility&apos;s yield). There is no per-stage split.
        </p>
        {mappingLoading && (
          <p className="body-medium text-[var(--color-text-secondary)]">
            Loading registry link…
          </p>
        )}
        {mappingError && (
          <ServerError
            message={
              mappingError instanceof Error
                ? mappingError.message
                : "Failed to load registry link"
            }
          />
        )}
        {!mappingLoading && !mappingError && !config && (
          <p className="body-medium text-[var(--color-text-secondary)]">
            Link this facility to an Isometric project in Certification
            Settings to preview submission data.
          </p>
        )}
        {config && yieldKwhPerL == null && (
          <p className="body-medium text-[var(--color-text-secondary)]">
            Set the genset yield in Admin → Emission estimates to convert genset
            diesel to the submitted kWh figure.
          </p>
        )}
        {config && yieldKwhPerL != null && gensetKwh != null && totals && (
          // Panel recipe (Phase 2.5): tables never sit flush on the warm field.
          <div className="overflow-x-auto bg-[var(--panel-bg)] [border:var(--panel-border)] [box-shadow:var(--panel-shadow)]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[var(--panel-head-bg)] [border-bottom:var(--panel-head-border)]">
                  <th className="label-micro text-[var(--color-text-secondary)] py-10 px-12 text-left">Source</th>
                  <th className="label-micro text-[var(--color-text-secondary)] py-10 px-12 text-right">Submitted value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="[border-bottom:var(--row-divider)]">
                  <td className="body-medium py-8 px-12">Grid electricity</td>
                  <td className="body-medium py-8 px-12 text-right whitespace-nowrap tabular-nums">
                    {fmt(electricityKwh)} kWh
                  </td>
                </tr>
                <tr className="[border-bottom:var(--row-divider)]">
                  <td className="body-medium py-8 px-12">
                    Diesel genset
                    <span className="block label-micro text-[var(--color-text-tertiary)]">
                      {fmt(gensetLitres)} L × {yieldKwhPerL} kWh/L
                    </span>
                  </td>
                  <td className="body-medium py-8 px-12 text-right whitespace-nowrap tabular-nums">
                    {fmt(gensetKwh)} kWh
                  </td>
                </tr>
                <tr className="last:[border-bottom:none]">
                  <td className="body-medium py-8 px-12">
                    Startup / plant diesel
                    <span className="block label-micro text-[var(--color-signal-orange)]">
                      Not submitted under the active template
                    </span>
                  </td>
                  <td className="body-medium py-8 px-12 text-right whitespace-nowrap tabular-nums text-[var(--color-text-tertiary)]">
                    {fmt(startupLitres)} L
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
