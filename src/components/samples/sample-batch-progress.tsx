/**
 * SampleBatchProgress — the lab-sample form's batch sampling-progress preview.
 *
 * A Sample characterises ONE credit batch (the protocol production batch —
 * ADR 0016, anchored directly since issue #309: the batch's biochar is
 * commingled across runs, so the form selects the batch, never a run). From the
 * chosen batch this panel shows live progress toward the protocol's ≥3
 * distributed-sample minimum (§8.3.1): the existing replicate count, the
 * runs/days they span (the distribution evidence), and the eligibility verdict
 * — the same `DurabilityReadinessSignals` the credit-batch detail uses.
 */
"use client";

import Link from "next/link";
import { ArrowSquareOutIcon, FlaskIcon } from "@phosphor-icons/react/dist/ssr";
import { useBatchDurabilitySummary } from "@/hooks/use-certification";
import type { DurabilityBatchSummary } from "@/lib/certification/durability-batch-summary";
import { DurabilityReadinessSignals } from "@/components/certification/durability-readiness";

interface SampleBatchProgressProps {
  /** The form's currently-selected credit batch. */
  creditBatchId: string | undefined;
}

/**
 * Distinct (run code, day) labels among the batch's pooled samples. Run
 * provenance only exists on legacy pre-re-grain rows — batch-anchored samples
 * label by sampling day alone.
 */
function distinctProvenanceLabels(summary: DurabilityBatchSummary): string[] {
  const seen = new Map<string, string>();
  for (const r of summary.replicates) {
    const day = r.samplingDay ?? "date unknown";
    const key = `${r.productionRunId ?? "?"}::${r.samplingDay ?? "?"}`;
    if (!seen.has(key)) {
      seen.set(key, r.productionRunCode ? `${r.productionRunCode} · ${day}` : day);
    }
  }
  return Array.from(seen.values());
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="sample-batch-progress"
      className="flex flex-col gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] p-16"
    >
      {children}
    </div>
  );
}

export function SampleBatchProgress({
  creditBatchId,
}: SampleBatchProgressProps) {
  const { data: summary, isLoading, error } = useBatchDurabilitySummary(
    creditBatchId ?? "",
    !!creditBatchId,
  );

  // No batch chosen yet — nothing to preview.
  if (!creditBatchId) return null;

  if (isLoading) {
    return (
      <Panel>
        <span
          className="body-caption text-[var(--color-text-tertiary)]"
          aria-busy="true"
        >
          Loading this credit batch&apos;s sampling progress…
        </span>
      </Panel>
    );
  }

  if (error || !summary) {
    return (
      <Panel>
        <span className="body-caption text-[var(--st-wait)]">
          Couldn&apos;t load this credit batch&apos;s sampling progress.
        </span>
      </Panel>
    );
  }

  const remaining = Math.max(
    0,
    summary.minimumReplicates - summary.usableReplicateCount,
  );
  const provenance = distinctProvenanceLabels(summary);

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-8">
        <span className="inline-flex items-center gap-6 body-small font-medium text-[var(--color-text-primary)]">
          <FlaskIcon
            size={15}
            weight="fill"
            className="shrink-0 text-[var(--color-text-tertiary)]"
            aria-hidden
          />
          Characterises credit batch {summary.creditBatchCode}
        </span>
        <Link
          href={`/credit-batches/${summary.creditBatchId}`}
          className="inline-flex items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
        >
          View batch
          <ArrowSquareOutIcon size={12} aria-hidden />
        </Link>
      </div>

      <DurabilityReadinessSignals summary={summary} />

      <p className="body-caption text-[var(--color-text-secondary)]">
        {remaining > 0
          ? `This batch has ${summary.usableReplicateCount} usable replicate${summary.usableReplicateCount === 1 ? "" : "s"} — add ${remaining} more (across distinct runs/days) to reach the ≥${summary.minimumReplicates} minimum.`
          : summary.distributionWarning
            ? `This batch meets ≥${summary.minimumReplicates}, but all replicates cluster on one run/day — §8.3.1 expects them distributed across distinct runs/days.`
            : `This batch already meets the ≥${summary.minimumReplicates}-sample minimum across distinct runs/days.`}
      </p>

      {provenance.length > 0 && (
        <div className="flex flex-wrap items-center gap-6">
          {provenance.map((label) => (
            <span
              key={label}
              className="inline-flex items-center border border-[var(--color-border-tertiary)] bg-[var(--color-background-white)] px-6 py-2 body-caption text-[var(--color-text-tertiary)]"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}
