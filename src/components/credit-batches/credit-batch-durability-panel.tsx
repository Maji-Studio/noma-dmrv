/**
 * CreditBatchDurabilityPanel — the credit-batch detail's "Lab samples" section
 * (Phase 5b). The credit batch IS the protocol production batch and the sampling
 * unit (ADR 0016), so this rolls up every lab Sample that characterises the batch
 * (across its member runs/days), shows the batch-level mean ± std-dev that the
 * measurement-sample submission actually sends, and states the readiness inline:
 * the §3 Table 2 eligibility verdict and the §8.3.1 ≥3 count. User-facing copy
 * stays plain — protocol § references live in the header InfoHint, not the body.
 *
 * Figures come from `buildDurabilityBatchSummaries` — the SAME aggregation the
 * submit pipeline feeds — so this panel reconciles exactly to what's submitted.
 * Native units (dimensionless H/C, carbon %, t); the registry wire-unit
 * transforms are a separate concern.
 */
"use client";

import Link from "next/link";
import {
  CaretDownIcon,
  FlaskIcon,
  PlusIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { SectionLabel } from "@/components/forms";
import { formatDate, formatTonnes } from "@/lib/format-utils";
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
import { sampleCreateHref, sampleDetailHref } from "@/lib/sample-create-intent";
import { SheetLinkRow, SheetLinkRows } from "./sheet-link-row";

function Section({
  children,
  action,
}: {
  children: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <section
      data-testid="credit-batch-durability-panel"
      className="flex flex-col gap-16 border-t border-[var(--color-border-tertiary)] pt-16"
    >
      <div className="flex items-center justify-between gap-12">
        <SectionLabel
          hint={
            <>
              Samples from this batch&apos;s production runs are pooled into one
              credit batch figure with a mean and standard deviation. The
              registry receives this figure for the 200-year durability claim. Protocol
              rules (module §8.3.1, §3 Table 2): at least 3 Samples representative
              of the batch&apos;s full range of physical characteristics, eligible
              when the pooled mean H/C_org
              &lt; {DURABILITY_ELIGIBILITY_CEILINGS.hToC} and O/C_org &lt;{" "}
              {DURABILITY_ELIGIBILITY_CEILINGS.oToC}.
            </>
          }
        >
          Lab Samples
        </SectionLabel>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SampleCreateAction({
  facilityId,
  creditBatchId,
  hasSamples,
}: {
  facilityId: string;
  creditBatchId: string;
  hasSamples: boolean;
}) {
  return (
    <Link
      href={sampleCreateHref(facilityId, creditBatchId)}
      className={buttonVariants({ variant: "default", size: "small" })}
    >
      <PlusIcon size={16} aria-hidden />
      {hasSamples ? "Record another Sample" : "Record a Sample"}
    </Link>
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
  return value == null ? "Not recorded" : value.toFixed(digits);
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
              aria-label="Outlier: exceeds an eligibility limit"
            />
          )}
          {r.sampleCode}
        </span>
      </td>
      <td className="px-10 py-8 body-caption text-[var(--color-text-secondary)]">
        {r.productionRunCode ?? "Not available"}
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

function SampleSummaryRows({
  summary,
  facilityId,
}: {
  summary: DurabilityBatchSummary;
  facilityId: string;
}) {
  return (
    <SheetLinkRows>
      {summary.replicates.map((replicate) => (
        <SheetLinkRow
          key={replicate.id}
          href={sampleDetailHref(facilityId, replicate.id)}
          ariaLabel={`Open lab Sample ${replicate.sampleCode}`}
          primary={
            <span className="inline-flex min-w-0 items-center gap-6">
              {replicate.outlier && (
                <WarningIcon
                  size={13}
                  weight="fill"
                  className="shrink-0 text-[var(--st-wait)]"
                  aria-label="Chemistry outlier"
                />
              )}
              {replicate.sampleCode}
            </span>
          }
          meta={
            <span className="body-caption text-[var(--color-text-tertiary)]">
              {sampleProvenanceLabel(replicate)}
            </span>
          }
        />
      ))}
    </SheetLinkRows>
  );
}

export function sampleProvenanceLabel(
  replicate: Pick<
    DurabilitySummaryReplicate,
    "productionRunCode" | "samplingDay"
  >,
): string {
  const source = replicate.productionRunCode ?? "Batch Sample";
  return replicate.samplingDay
    ? `${source} · ${formatDate(replicate.samplingDay)}`
    : source;
}

export function CreditBatchDurabilityPanel({
  creditBatchId,
  facilityId,
}: {
  creditBatchId: string;
  facilityId: string;
}) {
  const { data: summary, isLoading, error } =
    useBatchDurabilitySummary(creditBatchId);
  const action = (
    <SampleCreateAction
      facilityId={facilityId}
      creditBatchId={creditBatchId}
      hasSamples={(summary?.sampleCount ?? 0) > 0}
    />
  );

  if (isLoading) {
    return (
      <Section action={action}>
        <span
          className="body-caption text-[var(--color-text-tertiary)]"
          aria-busy="true"
        >
          Loading durability data…
        </span>
      </Section>
    );
  }

  if (error || !summary) {
    return (
      <Section action={action}>
        <span className="body-caption text-[var(--st-wait)]">
          {error?.message ??
            "This credit batch's durability Samples could not be loaded. Refresh the page and try again."}
        </span>
      </Section>
    );
  }

  if (summary.sampleCount === 0) {
    return (
      <Section action={action}>
        <EmptyState
          padding="md"
          icon={<FlaskIcon size={40} weight="duotone" />}
          title="No lab Samples yet"
          description="Lab Samples recorded for this credit batch appear here. Record at least three Samples that represent the batch's full range of physical characteristics."
        />
      </Section>
    );
  }

  return (
    <Section action={action}>
      <DurabilityReadinessSignals summary={summary} />
      <SampleSummaryRows summary={summary} facilityId={facilityId} />

      <details className="group border border-[var(--color-border-tertiary)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-12 px-12 py-10 body-small font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-medium)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]">
          View chemistry details
          <CaretDownIcon
            size={14}
            className="transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="flex flex-col gap-16 border-t border-[var(--color-border-tertiary)] p-12">
          {/* The batch-level figures the measurement-sample submission sends. */}
          <div className="flex flex-col gap-8">
            <span className="label-micro text-[var(--color-text-tertiary)]">
              Submitted to registry (mean ± s.d.)
            </span>
            <div className="grid grid-cols-2 gap-8">
              <SubmittedStat
                label="H/C_org (molar)"
                value={formatDurabilityStat(summary.submitted.hToCorg, 3)}
              />
              <SubmittedStat
                label="Total carbon"
                value={formatDurabilityStat(
                  summary.submitted.totalCarbonPercent,
                  1,
                )}
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
        </div>
      </details>
    </Section>
  );
}
