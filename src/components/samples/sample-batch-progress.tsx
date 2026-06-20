/**
 * SampleBatchProgress — the lab-sample form's derived-batch preview (Phase 5a).
 *
 * A Sample is entered against ONE production run for provenance, but it
 * characterises the CREDIT BATCH that run belongs to (ADR 0015). So from the
 * chosen run this panel derives that credit batch and shows live progress toward
 * the protocol's ≥3 distributed-sample minimum (§8.3.1): the existing replicate
 * count, the runs/days they span (the distribution evidence), and the eligibility
 * verdict — the same `DurabilityReadinessSignals` the credit-batch detail uses.
 *
 * The no-batch state is surfaced honestly: a run not yet grouped into a credit
 * batch still accepts samples (they save against the run), but the batch-level
 * ≥3 characterisation only begins once the run joins a batch — we never silently
 * pick one.
 */
"use client";

import Link from "next/link";
import { ArrowSquareOut, Flask, Info } from "@phosphor-icons/react/dist/ssr";
import { useRunDurabilitySummary } from "@/hooks/use-certification";
import type { DurabilityBatchSummary } from "@/lib/certification/durability-batch-summary";
import { DurabilityReadinessSignals } from "@/components/certification/durability-readiness";

interface SampleBatchProgressProps {
  /** The form's currently-selected production run (provenance anchor). */
  productionRunId: string | undefined;
}

/** Distinct (run code, day) labels among the batch's pooled samples. */
function distinctProvenanceLabels(summary: DurabilityBatchSummary): string[] {
  const seen = new Map<string, string>();
  for (const r of summary.replicates) {
    const run = r.productionRunCode ?? "Unassigned run";
    const day = r.samplingDay ?? "date unknown";
    const key = `${r.productionRunId ?? "?"}::${r.samplingDay ?? "?"}`;
    if (!seen.has(key)) seen.set(key, `${run} · ${day}`);
  }
  return Array.from(seen.values());
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] p-16">
      {children}
    </div>
  );
}

export function SampleBatchProgress({
  productionRunId,
}: SampleBatchProgressProps) {
  const { data, isLoading, error } = useRunDurabilitySummary(productionRunId);

  // No run chosen yet — nothing to derive.
  if (!productionRunId) return null;

  if (isLoading) {
    return (
      <Panel>
        <span
          className="body-caption text-[var(--color-text-tertiary)]"
          aria-busy="true"
        >
          Resolving the credit batch this sample characterises…
        </span>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel>
        <span className="body-caption text-[var(--st-wait)]">
          Couldn&apos;t resolve this run&apos;s credit batch.
        </span>
      </Panel>
    );
  }

  // Run not yet committed to a credit batch — say so honestly.
  if (!data?.creditBatch) {
    return (
      <Panel>
        <div className="flex items-start gap-8">
          <Info
            size={16}
            className="mt-1 shrink-0 text-[var(--color-text-tertiary)]"
            aria-hidden
          />
          <p className="body-caption text-[var(--color-text-secondary)]">
            This run isn&apos;t grouped into a credit batch yet. The sample still
            saves against the run — the batch-level ≥3-sample characterisation
            (§8.3.1) begins once the run joins a credit batch.
          </p>
        </div>
      </Panel>
    );
  }

  const summary = data.creditBatch;
  const remaining = Math.max(
    0,
    summary.minimumReplicates - summary.usableReplicateCount,
  );
  const provenance = distinctProvenanceLabels(summary);

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-8">
        <span className="inline-flex items-center gap-6 body-small font-medium text-[var(--color-text-primary)]">
          <Flask
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
          <ArrowSquareOut size={12} aria-hidden />
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
