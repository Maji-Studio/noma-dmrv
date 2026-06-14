/**
 * EnergySummary
 * Read-only facility rollup of electricity + diesel across production
 * runs, plus the per-stage breakdown that will be submitted to Isometric
 * (applying the facility's emission-estimate config).
 */
"use client";

import { Fire, GasPump, Lightning } from "@phosphor-icons/react";
import { ServerError } from "@/components/forms";
import { EmptyState, PageHeader } from "@/components/ui";
import { StatCard } from "@/components/ui/stat-card";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useFacilityEnergyTotals } from "@/hooks/use-production-runs";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";

const STAGES = [
  { key: "biomass", label: "Biomass processing" },
  { key: "pyrolysis", label: "Pyrolysis" },
  { key: "biochar", label: "Biochar processing" },
] as const;

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

  const splits =
    config &&
    config.stageSplitBiomassPct != null &&
    config.stageSplitPyrolysisPct != null &&
    config.stageSplitBiocharPct != null
      ? {
          biomass: config.stageSplitBiomassPct,
          pyrolysis: config.stageSplitPyrolysisPct,
          biochar: config.stageSplitBiocharPct,
        }
      : null;

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
        <h2 className="title-heading-3">Per-stage submission preview</h2>
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
            Settings to preview per-stage submission data.
          </p>
        )}
        {config && (!splits || yieldKwhPerL == null) && (
          <p className="body-medium text-[var(--color-text-secondary)]">
            Set the genset yield and stage splits in Admin → Emission estimates
            to see the per-stage breakdown.
          </p>
        )}
        {config && splits && yieldKwhPerL != null && gensetKwh != null && totals && (
          // Panel recipe (Phase 2.5): tables never sit flush on the warm field.
          <div className="overflow-x-auto bg-[var(--panel-bg)] [border:var(--panel-border)] [box-shadow:var(--panel-shadow)]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[var(--panel-head-bg)] [border-bottom:var(--panel-head-border)]">
                  <th className="label-micro text-[var(--color-text-secondary)] py-10 px-12 text-left">Stage</th>
                  <th className="label-micro text-[var(--color-text-secondary)] py-10 px-12 text-right whitespace-nowrap">Split</th>
                  <th className="label-micro text-[var(--color-text-secondary)] py-10 px-12 text-right">Grid electricity (kWh)</th>
                  <th className="label-micro text-[var(--color-text-secondary)] py-10 px-12 text-right">Genset energy (kWh)</th>
                </tr>
              </thead>
              <tbody>
                {STAGES.map((stage) => {
                  const pct = splits[stage.key];
                  return (
                    <tr
                      key={stage.key}
                      className="[border-bottom:var(--row-divider)] last:[border-bottom:none]"
                    >
                      <td className="body-medium py-8 px-12">{stage.label}</td>
                      <td className="body-medium py-8 px-12 text-right whitespace-nowrap">{pct}%</td>
                      <td className="body-medium py-8 px-12 text-right whitespace-nowrap tabular-nums">
                        {fmt((electricityKwh * pct) / 100)}
                      </td>
                      <td className="body-medium py-8 px-12 text-right whitespace-nowrap tabular-nums">
                        {fmt((gensetKwh * pct) / 100)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
