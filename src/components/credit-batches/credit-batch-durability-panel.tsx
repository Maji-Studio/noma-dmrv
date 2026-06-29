/**
 * CreditBatchDurabilityPanel — the credit-batch detail's durability section
 * (Phase 5b). The credit batch IS the protocol production batch and the sampling
 * unit (ADR 0016), so this rolls up every lab Sample that characterises the batch
 * (across its member runs/days), shows the batch-level mean ± std-dev that the
 * measurement-sample submission actually sends, and states the readiness inline:
 * the §3 Table 2 eligibility verdict, the §8.3.1 ≥3 count, and the distribution
 * across distinct runs/days.
 *
 * Figures come from `buildDurabilityBatchSummaries` — the SAME aggregation the
 * submit pipeline feeds — so this panel reconciles exactly to what's submitted.
 * Native units (dimensionless H/C, carbon %, t); the registry wire-unit
 * transforms are a separate concern.
 */
"use client";

import { FlaskIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/tooltip";
import { formatTonnes } from "@/lib/format-utils";
import { useBatchDurabilitySummary } from "@/hooks/use-certification";
import type {
  DurabilityBatchSummary,
  DurabilitySummaryReplicate,
} from "@/lib/certification/durability-batch-summary";
import {
  DURABILITY_ELIGIBILITY_CEILINGS,
  DurabilityReadinessSignals,
  formatDurabilityStat,
} from "@/components/certification/durability-readiness";

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section
      data-testid="credit-batch-durability-panel"
      className="flex flex-col gap-20 bg-[var(--panel-bg)] [border:var(--panel-border)] p-32"
    >
      <div className="flex flex-col gap-4">
        <h2 className="title-heading-3 flex items-center gap-6 text-[var(--color-text-primary)]">
          Durability samples
          <InfoHint>
            Lab samples that characterise this credit batch (the protocol
            production batch). The batch-level mean ± standard deviation below is
            what the 200-year sequestration measurement-sample submission sends.
          </InfoHint>
        </h2>
        <p className="body-small text-[var(--color-text-secondary)]">
          ≥3 independent samples across distinct runs/days, eligible on the pooled
          mean (H/C_org &lt; {DURABILITY_ELIGIBILITY_CEILINGS.hToC}, O/C_org &lt;{" "}
          {DURABILITY_ELIGIBILITY_CEILINGS.oToC}) — module §3 Table 2, §8.3.1.
        </p>
      </div>
      {children}
    </section>
  );
}

/** A submitted mean ± std-dev figure as a labelled stat. */
function SubmittedStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-4 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] p-12">
      <span className="label-micro text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <span className="body-medium font-medium text-[var(--color-text-primary)]">
        {value}
      </span>
      {hint && (
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {hint}
        </span>
      )}
    </div>
  );
}

function num(value: number | null, digits: number): string {
  return value == null ? "—" : value.toFixed(digits);
}

function ReplicateRow({ r }: { r: DurabilitySummaryReplicate }) {
  return (
    <tr className="border-t border-[var(--color-border-tertiary)]">
      <td className="px-10 py-8">
        <span className="inline-flex items-center gap-6 body-caption font-medium text-[var(--color-text-primary)]">
          {r.outlier && (
            <WarningIcon
              size={13}
              weight="fill"
              className="shrink-0 text-[var(--st-wait)]"
              aria-label="Outlier — exceeds an eligibility ceiling"
            />
          )}
          {r.sampleCode}
        </span>
      </td>
      <td className="px-10 py-8 body-caption text-[var(--color-text-secondary)]">
        {r.productionRunCode ?? "—"}
        {r.samplingDay ? ` · ${r.samplingDay}` : ""}
      </td>
      <td className="px-10 py-8 text-right tabular-nums body-caption text-[var(--color-text-secondary)]">
        {num(r.hToCorg, 3)}
      </td>
      <td className="px-10 py-8 text-right tabular-nums body-caption text-[var(--color-text-secondary)]">
        {num(r.oToCorg, 3)}
      </td>
      <td className="px-10 py-8 text-right tabular-nums body-caption text-[var(--color-text-secondary)]">
        {num(r.totalCarbonPercent, 1)}
      </td>
      <td className="px-10 py-8 text-right tabular-nums body-caption text-[var(--color-text-secondary)]">
        {num(r.organicCarbonPercent, 1)}
      </td>
    </tr>
  );
}

function ReplicateTable({ summary }: { summary: DurabilityBatchSummary }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse">
        <thead>
          <tr className="text-left">
            <th className="px-10 py-8 label-micro text-[var(--color-text-tertiary)]">
              Sample
            </th>
            <th className="px-10 py-8 label-micro text-[var(--color-text-tertiary)]">
              Run · day
            </th>
            <th className="px-10 py-8 text-right label-micro text-[var(--color-text-tertiary)]">
              H/C_org
            </th>
            <th className="px-10 py-8 text-right label-micro text-[var(--color-text-tertiary)]">
              O/C_org
            </th>
            <th className="px-10 py-8 text-right label-micro text-[var(--color-text-tertiary)]">
              Total C %
            </th>
            <th className="px-10 py-8 text-right label-micro text-[var(--color-text-tertiary)]">
              Organic C %
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.replicates.map((r) => (
            <ReplicateRow key={r.id} r={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CreditBatchDurabilityPanel({
  creditBatchId,
}: {
  creditBatchId: string;
}) {
  const { data: summary, isLoading, error } =
    useBatchDurabilitySummary(creditBatchId);

  if (isLoading) {
    return (
      <Section>
        <span
          className="body-caption text-[var(--color-text-tertiary)]"
          aria-busy="true"
        >
          Loading durability samples…
        </span>
      </Section>
    );
  }

  if (error || !summary) {
    return (
      <Section>
        <span className="body-caption text-[var(--st-wait)]">
          {error?.message ?? "Couldn't load this batch's durability samples."}
        </span>
      </Section>
    );
  }

  if (summary.sampleCount === 0) {
    return (
      <Section>
        <EmptyState
          padding="md"
          icon={<FlaskIcon size={40} weight="duotone" />}
          title="No durability samples yet"
          description="Lab samples entered against this batch's production runs roll up here. The protocol needs ≥3 independent samples across distinct runs/days (§8.3.1) before this batch can submit a 200-year removal."
        />
      </Section>
    );
  }

  const { eligibility } = summary;

  return (
    <Section>
      <DurabilityReadinessSignals summary={summary} />

      {/* Eligibility means vs the protocol ceilings (the verdict's working). */}
      <p className="body-caption text-[var(--color-text-secondary)]">
        Pooled mean H/C_org{" "}
        <span className="font-medium text-[var(--color-text-primary)]">
          {num(eligibility.hToCorgMean, 3)}
        </span>{" "}
        (&lt; {DURABILITY_ELIGIBILITY_CEILINGS.hToC}) · O/C_org{" "}
        <span className="font-medium text-[var(--color-text-primary)]">
          {num(eligibility.oToCorgMean, 3)}
        </span>{" "}
        (&lt; {DURABILITY_ELIGIBILITY_CEILINGS.oToC}). Judged on{" "}
        {summary.usableReplicateCount} replicate
        {summary.usableReplicateCount === 1 ? "" : "s"} with complete paired
        chemistry.
      </p>

      {/* The batch-level figures the measurement-sample submission sends. */}
      <div className="flex flex-col gap-8">
        <span className="label-micro text-[var(--color-text-tertiary)]">
          Submitted to registry (mean ± s.d.)
        </span>
        <div className="grid grid-cols-2 gap-12 sm:grid-cols-4">
          <SubmittedStat
            label="H/C_org (molar)"
            value={formatDurabilityStat(summary.submitted.hToCorg, 3)}
          />
          <SubmittedStat
            label="Total carbon"
            value={formatDurabilityStat(summary.submitted.totalCarbonPercent, 1)}
            hint="%"
          />
          <SubmittedStat
            label="Inorganic carbon"
            value={formatDurabilityStat(
              summary.submitted.inorganicCarbonPercent,
              1,
            )}
            hint="% (measured or Eq.2)"
          />
          <SubmittedStat
            label="Product mass"
            value={formatTonnes(summary.submitted.productMassKg / 1000)}
            hint="biochar dry mass"
          />
        </div>
      </div>

      <ReplicateTable summary={summary} />
    </Section>
  );
}
