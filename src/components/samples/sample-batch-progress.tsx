/**
 * SampleBatchProgress — the lab-sample form's batch sampling-progress preview.
 *
 * A Sample characterises ONE credit batch (the protocol production batch —
 * ADR 0016, anchored directly since issue #309: the batch's biochar is
 * commingled across runs, so the form selects the batch, never a run). From the
 * chosen batch this panel shows live progress toward the protocol's ≥3-sample
 * minimum (§8.3.1): the existing replicate count and the eligibility verdict —
 * the same `DurabilityReadinessSignals` the credit-batch detail uses. §8.3.1
 * requires no within-batch run/day distribution, so none is shown.
 */
"use client";

import Link from "next/link";
import { ArrowSquareOutIcon, FlaskIcon } from "@phosphor-icons/react/dist/ssr";
import { useBatchDurabilitySummary } from "@/hooks/use-certification";
import type { DurabilityBatchSummary } from "@/lib/certification/durability-batch-summary";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { DurabilityReadinessSignals } from "@/components/certification/durability-readiness";

/**
 * The sample-form inputs an operator actually types to close each universal
 * eligibility ratio (§3.3 Table 2) — NOT the ratios themselves. H:Corg is a
 * read-only derived field, and O:Corg falls back to O% ÷ C_org% when its
 * override is left blank (`sample-form.tsx`), so naming the ratios sent
 * operators looking for a field they cannot fill.
 */
const H_TO_CORG_INPUT_LABEL = "Hydrogen (%)";
const O_TO_CORG_INPUT_LABEL = "Oxygen (%)";

interface SampleBatchProgressProps {
  /** The form's currently-selected credit batch. */
  creditBatchId: string | undefined;
}

/** Replicates carrying BOTH eligibility ratios — the set every gate counts. */
function isUsableReplicate(
  replicate: DurabilityBatchSummary["replicates"][number],
): boolean {
  return replicate.hToCorg != null && replicate.oToCorg != null;
}

/**
 * The recorded samples that don't count yet only because an eligibility ratio
 * is blank — the actionable half of a sub-minimum batch, since filling the
 * missing value converts them into usable replicates without any new sampling.
 */
function summarizeIncompleteChemistry(summary: DurabilityBatchSummary): {
  count: number;
  /** The input(s) to fill, e.g. `"Oxygen (%)"` or `"Hydrogen (%) and Oxygen (%)"`. */
  label: string;
} {
  let count = 0;
  let anyMissingH = false;
  let anyMissingO = false;

  for (const r of summary.replicates) {
    if (isUsableReplicate(r)) continue;
    count += 1;
    anyMissingH ||= r.hToCorg == null;
    anyMissingO ||= r.oToCorg == null;
  }

  const missing = [
    ...(anyMissingH ? [H_TO_CORG_INPUT_LABEL] : []),
    ...(anyMissingO ? [O_TO_CORG_INPUT_LABEL] : []),
  ];
  return { count, label: missing.join(" and ") };
}

/**
 * The one-or-two-sentence progress hint. Below the minimum it names the real
 * gap: recorded-but-incomplete samples are a data-entry fix, not a reason to go
 * back out and sample more.
 */
function progressHint(summary: DurabilityBatchSummary): string {
  const usable = summary.usableReplicateCount;
  const minimum = summary.minimumReplicates;
  const remaining = Math.max(0, minimum - usable);

  if (remaining === 0) {
    return `This batch already meets the ≥${minimum}-sample minimum.`;
  }

  const usableClause = `This batch has ${usable} usable replicate${usable === 1 ? "" : "s"}`;
  const incomplete = summarizeIncompleteChemistry(summary);

  if (incomplete.count === 0) {
    return `${usableClause}. Add ${remaining} more to reach the ≥${minimum} minimum.`;
  }

  const stillShort = Math.max(0, remaining - incomplete.count);
  const thenAdd = stillShort > 0 ? `, then add ${stillShort} more` : "";
  return `${usableClause}. ${incomplete.count} recorded sample${incomplete.count === 1 ? " doesn't" : "s don't"} count yet. Enter ${incomplete.label} on ${incomplete.count === 1 ? "it" : "them"}${thenAdd} to reach the ≥${minimum} minimum.`;
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
          href={creditBatchDeepLinkHref(summary.creditBatchId)}
          className="inline-flex items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
        >
          View batch
          <ArrowSquareOutIcon size={12} aria-hidden />
        </Link>
      </div>

      <DurabilityReadinessSignals summary={summary} />

      <p className="body-caption text-[var(--color-text-secondary)]">
        {progressHint(summary)}
      </p>
    </Panel>
  );
}
