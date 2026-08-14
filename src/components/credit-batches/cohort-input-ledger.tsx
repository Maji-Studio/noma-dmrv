/**
 * CohortInputLedger
 *
 * Live summary of the front-loaded production inputs a credit batch will claim,
 * shown beneath the run picker as the cohort is (de)selected. These are the
 * production-bucket *quantities* noma submits (#349, ADR 0020); the registry
 * applies the emission factors (ADR 0018), so this panel never states a CO₂e
 * figure — only physical inputs and each run's share of dry output.
 */
"use client";

import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { isMissingValueCopy, MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate } from "@/lib/format-utils";
import { sumNullable, sumNullableBy } from "@/lib/nullable-sum";

// Per-run categorical palette for the dry-output composition bar. Accent hues
// (not semantic good/warn/critical) so adjacent segments stay distinguishable;
// cycles when a window has more runs than colors.
const COHORT_RUN_COLORS = [
  "var(--clr-orange)",
  "var(--clr-purple)",
  "var(--clr-red)",
  "var(--clr-pink)",
  "var(--clr-dark-purple)",
  "var(--clr-rose)",
] as const;

export interface CohortInputTotals {
  /** Σ biochar dry mass (kg). null when no selected run reports it. */
  dryOutputKg: number | null;
  /** Σ feedstock dry mass (kg). */
  feedstockDryKg: number | null;
  /** Σ startup + genset + preprocessing fuel (litres) — all one pyrolysis SSR. */
  dieselLiters: number | null;
  /** Σ grid electricity (kWh). */
  electricityKwh: number | null;
}

/** Pure aggregation over the selected cohort — unit-tested independently. */
export function computeCohortInputTotals(
  runs: CreditBatchProductionRunOption[],
): CohortInputTotals {
  return {
    dryOutputKg: sumNullableBy(runs, (run) => run.biocharDryMassKg),
    feedstockDryKg: sumNullableBy(runs, (run) => run.feedstockMassDryKg),
    dieselLiters: sumNullable(
      runs.flatMap((run) => [
        run.dieselOperationLiters,
        run.dieselGensetLiters,
        run.preprocessingFuelLiters,
      ]),
    ),
    electricityKwh: sumNullableBy(runs, (run) => run.electricityKwh),
  };
}

function formatTonnesFromKg(kg: number | null): string {
  if (kg == null) return MISSING_VALUE.notRecorded;
  return kgToTonnes(kg).toFixed(2);
}

function formatQuantity(value: number | null): string {
  if (value == null) return MISSING_VALUE.notRecorded;
  return Math.round(value).toLocaleString();
}

function Figure({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  const isEmpty = isMissingValueCopy(value);
  return (
    <div className="flex flex-col gap-2">
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <span
        className={`body-medium tabular-nums ${
          isEmpty
            ? "text-[var(--color-text-tertiary)]"
            : "text-[var(--color-text-primary)]"
        }`}
      >
        {value}
        {!isEmpty && (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {" "}
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

export function CohortInputLedger({
  runs,
}: {
  runs: CreditBatchProductionRunOption[];
}) {
  if (runs.length === 0) return null;

  const totals = computeCohortInputTotals(runs);

  // Composition segments: each run's share of the cohort's dry output. Only
  // runs that actually report dry output contribute a segment.
  const dryOutputKg = totals.dryOutputKg ?? 0;
  const segments =
    dryOutputKg > 0
      ? runs
          .map((run, index) => ({
            id: run.id,
            label: [formatDate(run.date), run.biocharStorageName]
              .filter(Boolean)
              .join(" · "),
            kg: run.biocharDryMassKg ?? 0,
            color: COHORT_RUN_COLORS[index % COHORT_RUN_COLORS.length],
          }))
          .filter((segment) => segment.kg > 0)
      : [];

  return (
    <section
      className="border-t-2 border-[var(--clr-orange)] bg-[var(--color-background-medium)]"
      aria-label="Production inputs this batch claims"
    >
      <div className="flex items-baseline justify-between gap-12 px-18 pt-16 pb-12">
        <span className="body-small font-medium text-[var(--color-text-primary)]">
          Production inputs this batch claims
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {runs.length} {runs.length === 1 ? "run" : "runs"}
        </span>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-24 gap-y-16 px-18 pb-12">
        <Figure
          label="Dry output"
          value={formatTonnesFromKg(totals.dryOutputKg)}
          unit="t"
        />
        <Figure
          label="Feedstock dry mass"
          value={formatTonnesFromKg(totals.feedstockDryKg)}
          unit="t"
        />
        <Figure
          label="Diesel · startup + genset + preprocess"
          value={formatQuantity(totals.dieselLiters)}
          unit="L"
        />
        <Figure
          label="Grid electricity"
          value={formatQuantity(totals.electricityKwh)}
          unit="kWh"
        />
      </dl>

      {segments.length > 0 && (
        <div className="px-18 pb-16 space-y-8">
          <div className="flex h-12 overflow-hidden bg-[var(--color-background-medium)]">
            {segments.map((segment) => (
              <span
                key={segment.id}
                className="h-full"
                style={{
                  width: `${(segment.kg / dryOutputKg) * 100}%`,
                  background: segment.color,
                }}
                title={`${segment.label}: ${formatTonnesFromKg(segment.kg)} t dry output`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-16 gap-y-6">
            {segments.map((segment) => (
              <span
                key={segment.id}
                className="flex items-center gap-6 body-caption text-[var(--color-text-tertiary)]"
              >
                <span
                  className="h-8 w-8 shrink-0"
                  style={{ background: segment.color }}
                />
                {segment.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="px-18 pb-16 pt-4 body-caption text-[var(--color-text-tertiary)] leading-relaxed border-t border-[var(--color-border-tertiary)]">
        Each input is claimed once in full for this credit batch, even when its
        output is later split across Removals. Isometric calculates CO₂e at
        submission. noma submits the quantities above, not emission factors.
      </p>
    </section>
  );
}
