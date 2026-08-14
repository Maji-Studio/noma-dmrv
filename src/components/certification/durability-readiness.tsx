/**
 * Shared presentation for the 200-year durability sampling readiness of a credit
 * batch — the signals the protocol gate turns on (§8.3.1 ≥3 replicates,
 * §3 Table 2 eligibility), plus a
 * mean ± std-dev formatter. Used by BOTH Phase-5 surfaces (the lab-sample form's
 * derived-batch preview and the credit-batch detail's durability section) so they
 * read identically. Pure presentation over a `DurabilityBatchSummary`.
 */
"use client";

import {
  CheckCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Tooltip } from "@/components/ui/tooltip";
import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  O_TO_C_ORG_ELIGIBILITY_MAX,
} from "@/lib/calculations/biochar-eligibility";
import {
  type DurabilityBatchSummary,
  type DurabilitySummaryEligibility,
} from "@/lib/certification/durability-batch-summary";
import type { ValueWithStdDev } from "@/lib/isometric/utils/durability-aggregation";

type Tone = "ok" | "wait" | "bad" | "off";

const TONE_CLASSES: Record<Tone, string> = {
  ok: "border-[var(--st-ok-border)] bg-[var(--st-ok-bg)] text-[var(--st-ok)]",
  wait: "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]",
  bad: "border-[var(--st-bad-border)] bg-[var(--st-bad-bg)] text-[var(--st-bad)]",
  off: "border-[var(--st-off-border)] bg-[var(--st-off-bg)] text-[var(--color-text-tertiary)]",
};

function ReadinessChip({
  tone,
  icon,
  hint,
  children,
}: {
  tone: Tone;
  icon?: React.ReactNode;
  /** Plain-language explanation of what the signal means; shown on hover/focus. */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  const body = (
    <>
      {icon && (
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
      )}
      {children}
    </>
  );
  const className = `inline-flex items-center gap-6 border px-8 py-4 body-caption font-medium ${TONE_CLASSES[tone]}`;

  if (!hint) return <span className={className}>{body}</span>;

  // The chip itself is the tooltip trigger — a separate ⓘ icon on each of three
  // adjacent chips reads as noise, and every chip here needs an explanation.
  return (
    <Tooltip content={hint}>
      <button
        type="button"
        className={`${className} cursor-help text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]`}
      >
        {body}
      </button>
    </Tooltip>
  );
}

/**
 * Format a submitted mean ± sample std-dev for display. `"0.412 ± 0.018"`, or
 * just the mean when there's a single replicate (no std-dev), or "Not available"
 * when the
 * batch has no usable replicate for the figure.
 */
export function formatDurabilityStat(
  stat: ValueWithStdDev | null,
  digits = 3,
): string {
  if (stat == null) return "Not available";
  const mean = stat.mean.toFixed(digits);
  return stat.stdDev == null ? mean : `${mean} ± ${stat.stdDev.toFixed(digits)}`;
}

/**
 * Eligibility chip — the §3 Table 2 verdict (fails closed when indeterminate).
 * Labelled "chemistry eligible" rather than a bare "Eligible": this judges the
 * batch's pooled chemistry only, on a different clock and predicate from the
 * Method-B "baseline samples" counter in the feedstock-type sampling detail — a bare
 * "Eligible" here reads as compliance progress there (QA 2026-07-21 F1).
 */
function eligibilityChip(
  eligibility: DurabilitySummaryEligibility,
  hasUsableReplicates: boolean,
): { tone: Tone; icon: React.ReactNode; label: string; hint: string } {
  const thresholds = `H/C_org below ${DURABILITY_ELIGIBILITY_CEILINGS.hToC} and O/C_org below ${DURABILITY_ELIGIBILITY_CEILINGS.oToC}`;

  if (eligibility.eligible === true) {
    return {
      tone: "ok",
      icon: <CheckCircleIcon size={14} weight="fill" />,
      label: "Chemistry eligible",
      hint: `This batch's pooled Sample chemistry qualifies as biochar: ${thresholds}. The mean across Samples determines eligibility.`,
    };
  }
  if (eligibility.eligible === false) {
    return {
      tone: "bad",
      icon: <XCircleIcon size={14} weight="fill" />,
      label: "Chemistry ineligible",
      hint: `The pooled mean misses the biochar thresholds (${thresholds}), so this batch cannot be certified with its current Samples.`,
    };
  }
  // null — indeterminate. Distinguish "no chemistry yet" from "partial chemistry".
  return hasUsableReplicates
    ? {
        tone: "wait",
        icon: undefined,
        label: "Chemistry indeterminate",
        hint: `The recorded Samples do not resolve both ratios, so eligibility (${thresholds}) cannot be judged. Add the missing H/C_org or O/C_org results.`,
      }
    : {
        tone: "off",
        icon: undefined,
        label: "Awaiting chemistry",
        hint: `No Sample has lab chemistry yet. Eligibility needs ${thresholds} on the pooled mean.`,
      };
}

/**
 * The two durability readiness signals as inline chips: representative Sample
 * count toward ≥3 and the eligibility verdict.
 */
export function DurabilityReadinessSignals({
  summary,
}: {
  summary: DurabilityBatchSummary;
}) {
  const { usableReplicateCount, minimumReplicates, meetsMinimum } = summary;
  const eligibility = eligibilityChip(
    summary.eligibility,
    usableReplicateCount > 0,
  );
  const signals: Array<{
    key: string;
    tone: Tone;
    icon?: React.ReactNode;
    content: React.ReactNode;
    hint?: React.ReactNode;
  }> = [
    {
      key: "chemistry",
      tone: eligibility.tone,
      icon: eligibility.icon,
      content: eligibility.label,
      hint: eligibility.hint,
    },
    {
      key: "replicates",
      tone: meetsMinimum ? "ok" as const : "wait" as const,
      icon: meetsMinimum ? (
        <CheckCircleIcon size={14} weight="fill" />
      ) : undefined,
      content: `${usableReplicateCount} of ${minimumReplicates} usable Samples`,
      hint: `Only Samples with both H/C_org and O/C_org results count. This batch needs at least ${minimumReplicates}; ${usableReplicateCount} ${
        usableReplicateCount === 1 ? "is" : "are"
      } complete so far.`,
    },
  ].sort(
    (left, right) =>
      Number(right.tone === "ok") - Number(left.tone === "ok"),
  );

  return (
    <div
      data-testid="durability-readiness-signals"
      className="flex flex-wrap items-center gap-8"
    >
      {signals.map((signal) => (
        <ReadinessChip
          key={signal.key}
          tone={signal.tone}
          icon={signal.icon}
          hint={signal.hint}
        >
          {signal.content}
        </ReadinessChip>
      ))}
    </div>
  );
}

/** The eligibility ceilings, for helper copy next to the verdict. */
export const DURABILITY_ELIGIBILITY_CEILINGS = {
  hToC: H_TO_C_ORG_ELIGIBILITY_MAX,
  oToC: O_TO_C_ORG_ELIGIBILITY_MAX,
} as const;
