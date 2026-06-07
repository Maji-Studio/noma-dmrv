/**
 * EnergySummary
 * Read-only facility rollup of electricity + diesel across production
 * runs, plus the per-stage breakdown that will be submitted to Isometric
 * (applying the facility's emission-estimate config).
 */
"use client";

import { ServerError } from "@/components/forms";
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

function SummaryCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="border border-[var(--color-border-secondary)] p-16 flex flex-col gap-4">
      <span className="body-small text-[var(--color-text-secondary)]">{label}</span>
      <span className="title-heading-3">
        {value} <span className="body-small text-[var(--color-text-secondary)]">{unit}</span>
      </span>
    </div>
  );
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
      <p className="body-medium text-[var(--color-text-secondary)]">
        Select a facility to view its energy summary.
      </p>
    );
  }

  if (totalsError) {
    return (
      <div className="flex flex-col gap-16">
        <header className="flex flex-col gap-4">
          <h1 className="title-heading-2">Electricity &amp; diesel</h1>
          <p className="body-medium text-[var(--color-text-secondary)]">
            Energy totals could not be loaded for this facility.
          </p>
        </header>
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
    <div className="flex flex-col gap-24">
      <header className="flex flex-col gap-4">
        <h1 className="title-heading-2">Electricity &amp; diesel</h1>
        <p className="body-medium text-[var(--color-text-secondary)]">
          Rolled up across {runCount} production run
          {runCount === 1 ? "" : "s"}. This is what feeds the energy
          datapoints of an Isometric submission.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-16">
        <SummaryCard
          label="Grid electricity"
          value={isLoading ? "—" : fmt(electricityKwh)}
          unit="kWh"
        />
        <SummaryCard
          label="Genset diesel"
          value={isLoading ? "—" : fmt(gensetLitres)}
          unit="L"
        />
        <SummaryCard
          label="Startup / plant diesel"
          value={isLoading ? "—" : fmt(startupLitres)}
          unit="L"
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
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--color-border-secondary)] text-left">
                <th className="body-small text-[var(--color-text-secondary)] py-8">Stage</th>
                <th className="body-small text-[var(--color-text-secondary)] py-8">Split</th>
                <th className="body-small text-[var(--color-text-secondary)] py-8">Grid electricity (kWh)</th>
                <th className="body-small text-[var(--color-text-secondary)] py-8">Genset energy (kWh)</th>
              </tr>
            </thead>
            <tbody>
              {STAGES.map((stage) => {
                const pct = splits[stage.key];
                return (
                  <tr
                    key={stage.key}
                    className="border-b border-[var(--color-border-secondary)]"
                  >
                    <td className="body-medium py-8">{stage.label}</td>
                    <td className="body-medium py-8">{pct}%</td>
                    <td className="body-medium py-8">
                      {fmt((electricityKwh * pct) / 100)}
                    </td>
                    <td className="body-medium py-8">
                      {fmt((gensetKwh * pct) / 100)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
