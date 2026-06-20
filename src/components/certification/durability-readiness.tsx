/**
 * Shared presentation for the 200-year durability sampling readiness of a credit
 * batch — the three signals the protocol gate turns on (§8.3.1 ≥3 replicates,
 * §8.3.1 distribution across distinct runs/days, §3 Table 2 eligibility), plus a
 * mean ± std-dev formatter. Used by BOTH Phase-5 surfaces (the lab-sample form's
 * derived-batch preview and the credit-batch detail's durability section) so they
 * read identically. Pure presentation over a `DurabilityBatchSummary`.
 */
"use client";

import {
  CheckCircle,
  Circle,
  Warning,
  XCircle,
} from "@phosphor-icons/react/dist/ssr";
import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  O_TO_C_ORG_ELIGIBILITY_MAX,
} from "@/lib/calculations/biochar-eligibility";
import type {
  DurabilityBatchSummary,
  DurabilitySummaryEligibility,
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
  children,
}: {
  tone: Tone;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-6 border px-8 py-4 body-caption font-medium ${TONE_CLASSES[tone]}`}
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      {children}
    </span>
  );
}

/**
 * Format a submitted mean ± sample std-dev for display. `"0.412 ± 0.018"`, or
 * just the mean when there's a single replicate (no std-dev), or `"—"` when the
 * batch has no usable replicate for the figure.
 */
export function formatDurabilityStat(
  stat: ValueWithStdDev | null,
  digits = 3,
): string {
  if (stat == null) return "—";
  const mean = stat.mean.toFixed(digits);
  return stat.stdDev == null ? mean : `${mean} ± ${stat.stdDev.toFixed(digits)}`;
}

/** Eligibility chip — the §3 Table 2 verdict (fails closed when indeterminate). */
function eligibilityChip(
  eligibility: DurabilitySummaryEligibility,
  hasUsableReplicates: boolean,
): { tone: Tone; icon: React.ReactNode; label: string } {
  if (eligibility.eligible === true) {
    return {
      tone: "ok",
      icon: <CheckCircle size={14} weight="fill" />,
      label: "Eligible",
    };
  }
  if (eligibility.eligible === false) {
    return {
      tone: "bad",
      icon: <XCircle size={14} weight="fill" />,
      label: "Ineligible",
    };
  }
  // null — indeterminate. Distinguish "no chemistry yet" from "partial chemistry".
  return hasUsableReplicates
    ? {
        tone: "wait",
        icon: <Warning size={14} weight="fill" />,
        label: "Eligibility indeterminate",
      }
    : {
        tone: "off",
        icon: <Circle size={14} />,
        label: "Awaiting chemistry",
      };
}

/**
 * The three durability readiness signals as inline chips: replicate count toward
 * ≥3, distribution across runs/days, and the eligibility verdict. The
 * distribution chip only shows once ≥3 is met (below it, the ≥3 gap is the story).
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

  return (
    <div className="flex flex-wrap items-center gap-8">
      <ReadinessChip
        tone={meetsMinimum ? "ok" : "wait"}
        icon={
          meetsMinimum ? (
            <CheckCircle size={14} weight="fill" />
          ) : (
            <Warning size={14} weight="fill" />
          )
        }
      >
        {usableReplicateCount} of {minimumReplicates} replicates
      </ReadinessChip>

      {meetsMinimum && (
        <ReadinessChip
          tone={summary.distributionWarning ? "wait" : "ok"}
          icon={
            summary.distributionWarning ? (
              <Warning size={14} weight="fill" />
            ) : (
              <CheckCircle size={14} weight="fill" />
            )
          }
        >
          {summary.distributionWarning
            ? "Clustered on one run/day"
            : `${summary.distinctRunDayCount} distinct runs/days`}
        </ReadinessChip>
      )}

      <ReadinessChip tone={eligibility.tone} icon={eligibility.icon}>
        {eligibility.label}
      </ReadinessChip>
    </div>
  );
}

/** The eligibility ceilings, for helper copy next to the verdict. */
export const DURABILITY_ELIGIBILITY_CEILINGS = {
  hToC: H_TO_C_ORG_ELIGIBILITY_MAX,
  oToC: O_TO_C_ORG_ELIGIBILITY_MAX,
} as const;
