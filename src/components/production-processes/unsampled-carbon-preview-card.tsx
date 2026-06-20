/**
 * UnsampledCarbonPreviewCard — the NON-AUTHORITATIVE unsampled-batch carbon
 * preview for a production process (ADR 0017 Track 2, item 6 / D1·D6).
 *
 * Shows the conservative organic-carbon estimate (Eq 4: μ − σ/√n) over the
 * process's eligible-sample pool, plus its freshness (how many eligible samples,
 * over what trailing window). The registry computes the CREDITED number
 * (ADR 0013 / D1) — this is an operator preview only, and it says so plainly.
 *
 * Pure presentational + one lazy query (`useUnsampledCarbonPreview`); render it
 * only when a process is selected so the query stays scoped.
 */
"use client";

import { Flask, Info } from "@phosphor-icons/react";
import { useUnsampledCarbonPreview } from "@/hooks/use-production-processes";
import { InfoHint } from "@/components/ui/tooltip";

/** Display precision for organic-carbon percentages (dry basis). */
const CARBON_PERCENT_DIGITS = 2;

function formatPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(CARBON_PERCENT_DIGITS)}%`;
}

interface UnsampledCarbonPreviewCardProps {
  processId: string;
  /** Gate the query — pass the panel's open state so it fires only when shown. */
  enabled?: boolean;
}

export function UnsampledCarbonPreviewCard({
  processId,
  enabled = true,
}: UnsampledCarbonPreviewCardProps) {
  const { data, isLoading, error } = useUnsampledCarbonPreview(
    processId,
    undefined,
    enabled,
  );

  const preview = data?.preview;

  return (
    <div className="flex flex-col gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] p-16">
      <div className="flex items-start gap-8">
        <Flask
          size={16}
          weight="bold"
          className="mt-2 shrink-0 text-[var(--st-run)]"
        />
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-6 body-small-bold text-[var(--color-text-primary)]">
            Unsampled-batch carbon preview
            <InfoHint label="About the unsampled-batch preview">
              The conservative estimate an unsampled Method-B batch would carry —
              the eligible-pool mean minus one standard error (Eq 4: μ − σ/√n).
              The registry recomputes and winsorises this; noma only previews it.
            </InfoHint>
          </p>
          <p className="body-caption text-[var(--color-text-tertiary)]">
            Estimated organic carbon (dry basis) for a batch credited without its
            own sample.
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Computing preview…
        </p>
      ) : error ? (
        <p className="body-small text-[var(--st-bad)]">
          {error.message || "Could not compute the preview."}
        </p>
      ) : preview ? (
        <div className="flex flex-col gap-12">
          <div className="flex items-end gap-8">
            <span className="title-heading-2 tabular-nums text-[var(--color-text-primary)]">
              {formatPercent(preview.estimateOrganicCarbonPercent)}
            </span>
            <span className="body-caption text-[var(--color-text-tertiary)] mb-4">
              conservative estimate (μ − σ/√n)
            </span>
          </div>

          <dl className="grid grid-cols-3 gap-8">
            <PreviewStat
              label="Mean (μ)"
              value={formatPercent(preview.meanOrganicCarbonPercent)}
            />
            <PreviewStat
              label="Std dev (σ)"
              value={formatPercent(preview.stdDevOrganicCarbonPercent)}
            />
            <PreviewStat
              label="Std error (σ/√n)"
              value={formatPercent(preview.standardError)}
            />
          </dl>

          <p className="body-caption text-[var(--color-text-tertiary)] tabular-nums">
            Pooled from {preview.eligibleSampleCount} eligible sample
            {preview.eligibleSampleCount === 1 ? "" : "s"} over the trailing{" "}
            {preview.windowMonths} months.
          </p>

          {preview.notes.length > 0 && (
            <ul className="flex flex-col gap-4">
              {preview.notes.map((note, i) => (
                <li
                  key={i}
                  className="flex items-start gap-6 body-caption text-[var(--color-text-tertiary)]"
                >
                  <Info size={12} weight="bold" className="mt-2 shrink-0" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="border-t border-[var(--color-border-tertiary)] pt-8 body-caption text-[var(--color-text-tertiary)]">
            Non-authoritative preview — the registry computes the credited number.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className="body-caption text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className="body-small tabular-nums text-[var(--color-text-primary)]">
        {value}
      </dd>
    </div>
  );
}
