/**
 * EnergySummary
 * Read-only facility rollup of electricity + diesel across production runs,
 * plus a preview of the combined energy datapoints submitted to Isometric
 * (ADR 0015 amended by issue #319 — one grid-electricity datapoint in kWh and
 * one combined diesel datapoint in litres, submitted by volume with the
 * emission factor bound on the Isometric template; no litres→kWh conversion,
 * no per-stage split).
 *
 * The preview is capability-agnostic by design: it renders off the DB-only
 * `loadFacilityCertifierSummary` (which deliberately never hits the Isometric
 * API) and cannot know whether the active removal template declares the
 * monitored `pyrolysis / fuel_usage_by_volume / volume_of_fuel` input that
 * carries the diesel litres. The copy below caveats this instead of asserting
 * the figures as submitted — when the template can't carry the diesel, submit
 * omits it and readiness surfaces the buildSubmissionWarnings advisory.
 */
"use client";

import { FireIcon, GasPumpIcon, LightningIcon } from "@phosphor-icons/react";
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
  const totalDieselLitres = gensetLitres + startupLitres;

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
          icon={<LightningIcon size={48} />}
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
          icon={<FireIcon size={24} weight="bold" />}
          description="Rolled up in this summary"
          isLoading={isLoading}
        />
        <StatCard
          title="Grid Electricity"
          value={`${fmt(electricityKwh)} kWh`}
          icon={<LightningIcon size={24} weight="bold" />}
          description="All production runs"
          isLoading={isLoading}
        />
        <StatCard
          title="Genset Diesel"
          value={`${fmt(gensetLitres)} L`}
          icon={<GasPumpIcon size={24} weight="bold" />}
          description="All production runs"
          isLoading={isLoading}
        />
        <StatCard
          title="Startup / Plant Diesel"
          value={`${fmt(startupLitres)} L`}
          icon={<GasPumpIcon size={24} weight="bold" />}
          description="All production runs"
          isLoading={isLoading}
        />
      </div>

      <div className="flex flex-col gap-12">
        <h2 className="title-heading-3">Submission preview</h2>
        <p className="body-small text-[var(--color-text-secondary)]">
          Energy submits as a single combined measurement point — one grid
          electricity datapoint (kWh) and one diesel fuel datapoint (genset +
          startup litres, submitted by volume). The diesel emission factor is
          bound on the Isometric template. There is no per-stage split. Each
          value is submitted only if the active removal template declares the
          matching component — if it cannot carry the diesel litres, they are
          omitted and submission readiness shows an advisory.
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
        {config && totals && (
          // Panel recipe (Phase 2.5): tables never sit flush on the warm field.
          <div className="overflow-x-auto bg-[var(--panel-bg)] [border:var(--panel-border)] [box-shadow:var(--panel-shadow)]">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[var(--panel-head-bg)] [border-bottom:var(--panel-head-border)]">
                  <th className="label-micro text-[var(--color-text-secondary)] py-10 px-12 text-left">Source</th>
                  <th className="label-micro text-[var(--color-text-secondary)] py-10 px-12 text-right">Preview value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="[border-bottom:var(--row-divider)]">
                  <td className="body-medium py-8 px-12">Grid electricity</td>
                  <td className="body-medium py-8 px-12 text-right whitespace-nowrap tabular-nums">
                    {fmt(electricityKwh)} kWh
                  </td>
                </tr>
                <tr className="last:[border-bottom:none]">
                  <td className="body-medium py-8 px-12">
                    Diesel fuel (genset + startup)
                    <span className="block label-micro text-[var(--color-text-tertiary)]">
                      Submitted by volume when the active template carries a
                      pyrolysis fuel-usage component; emission factor bound on
                      the Isometric template
                    </span>
                  </td>
                  <td className="body-medium py-8 px-12 text-right whitespace-nowrap tabular-nums">
                    {fmt(totalDieselLitres)} L
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
