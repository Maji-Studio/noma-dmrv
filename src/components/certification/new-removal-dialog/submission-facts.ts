/**
 * One derivation of everything the confirm-&-submit step can say, so the
 * verdict line, the sending panel and the checks list can never disagree about
 * a number or a state.
 *
 * Copy here is operator language, never compiler vocabulary: the headline names
 * the state, the detail names the next action.
 */
import type { RemovalCompilationView } from "@/fn/certification";
import type {
  MemberCreditBatch,
  RemovalCertifyContext,
} from "@/fn/certification/certify-context";
import type { RemovalRequirementCheck } from "@/lib/certification/readiness";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import type { DurabilityOption } from "@/schemas/credit-batches";

/** Digits used for every dry-mass figure on this screen. */
const TONNE_DIGITS = 1;

export interface SubmissionFactsInput {
  ctx: RemovalCertifyContext;
  compilation: RemovalCompilationView | null;
  isCompilationLoading: boolean;
  compilationError: Error | null;
  checks: RemovalRequirementCheck[];
}

export type SubmitState = "loading" | "ready" | "blocked";

export interface SubmissionFacts {
  batches: MemberCreditBatch[];
  dryTons: string;
  batchCount: number;
  runCount: number;
  applicationCount: number;
  windowLabel: string | null;
  projectLabel: string | null;
  environmentLabel: string;
  isProduction: boolean;
  durabilityLabel: string;
  samplingLabel: string;
  pendingDocuments: number;
  checksPassed: number;
  checksTotal: number;
  checksAttention: number;
  state: SubmitState;
  /** Verdict headline. Plain language, never compiler vocabulary. */
  headline: string;
  /** One sentence under the headline. Names the next action when blocked. */
  detail: string;
  blockers: string[];
  warnings: string[];
}

/**
 * Sentence case, unlike the shared `formatDurabilityOption`, which returns
 * title case and is used on surfaces that want it that way.
 */
const DURABILITY_LABELS: Record<DurabilityOption, string> = {
  "200_year": "200-year (H:Corg)",
  "1000_year": "1000-year (R₀ reflectance)",
};

/**
 * The submit button gates on this: a compiled artifact with no blockers is the
 * only thing that can be sent to the registry.
 */
export function isRemovalCompilationReady(
  compilation: RemovalCompilationView | null,
): boolean {
  if (!compilation) return false;
  return (
    compilation.blockers.length === 0 &&
    compilation.snapshot !== null &&
    compilation.compilationHash !== null
  );
}

export function countLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Submit-time advisories describe automatic work, not operator work. Keep those
 * facts in the sending panel instead of counting them as checks the operator
 * must fix.
 */
export function actionableSubmissionChecks(
  checks: RemovalRequirementCheck[],
): RemovalRequirementCheck[] {
  return checks.filter((check) => check.status !== "warning");
}

function sum(
  batches: MemberCreditBatch[],
  value: (batch: MemberCreditBatch) => number,
): number {
  return batches.reduce((total, batch) => total + value(batch), 0);
}

function uniqueLabels(values: string[]): string {
  return [...new Set(values)].join(", ");
}

function creditingWindowLabel(batches: MemberCreditBatch[]): string | null {
  if (batches.length === 0) return null;
  const start = batches
    .map((batch) => batch.startDate)
    .sort()
    .at(0);
  const end = batches
    .map((batch) => batch.endDate)
    .sort()
    .at(-1);
  return start && end ? formatDateRange(start, end) : null;
}

export function buildSubmissionFacts({
  ctx,
  compilation,
  isCompilationLoading,
  compilationError,
  checks,
}: SubmissionFactsInput): SubmissionFacts {
  const batches = ctx.memberBatches;
  const actionChecks = actionableSubmissionChecks(checks);
  const checksPassed = actionChecks.filter(
    (check) => check.status === "met",
  ).length;
  const checksAttention = actionChecks.filter(
    (check) => check.status === "unmet",
  ).length;

  const compilationReady = isRemovalCompilationReady(compilation);
  const blockers = compilation?.blockers ?? [];

  let state: SubmitState = "ready";
  let headline = "Ready to submit";
  // Counts what passed, not what was evaluated: `actionChecks` also holds
  // checks a skipped upstream left unevaluable, which never "passed".
  let detail =
    checksPassed > 0
      ? `${countLabel(checksPassed, "check")} passed. Nothing left to fix.`
      : "Nothing left to fix.";

  // Checks outrank compiler blockers: they name the record and link to the fix,
  // where a blocker string is the same fault in compiler words. When both fire,
  // the operator only needs to read one of them.
  if (isCompilationLoading) {
    state = "loading";
    headline = "Preparing the submission";
    detail = "This takes a moment.";
  } else if (checksAttention > 0) {
    state = "blocked";
    headline =
      checksAttention === 1
        ? "1 issue blocks submission"
        : `${checksAttention} issues block submission`;
    detail =
      checksAttention === 1
        ? "Review the issue below."
        : "Review the issues below.";
  } else if (compilationError || !compilation) {
    state = "blocked";
    headline = "Cannot submit yet";
    detail =
      "The submission did not build. Retry, then open Debug if it fails again.";
  } else if (!compilationReady) {
    state = "blocked";
    headline = "Cannot submit yet";
    detail =
      blockers.length > 0
        ? "Clear the blockers below."
        : "The submission is incomplete. Open Debug to see what is missing.";
  }

  return {
    batches,
    dryTons: formatTonnes(
      sum(batches, (batch) => batch.appliedDryWeightTons),
      { digits: TONNE_DIGITS },
    ),
    batchCount: batches.length,
    runCount: sum(batches, (batch) => batch.productionRunCount),
    applicationCount: sum(batches, (batch) => batch.applicationCount),
    windowLabel: creditingWindowLabel(batches),
    projectLabel: ctx.project?.name ?? ctx.mapping?.externalProjectId ?? null,
    environmentLabel: ctx.isProduction ? "Production" : "Sandbox",
    isProduction: ctx.isProduction,
    durabilityLabel: uniqueLabels(
      batches.map((batch) => DURABILITY_LABELS[batch.durabilityOption]),
    ),
    samplingLabel: uniqueLabels(
      batches.map((batch) =>
        batch.sampling === "sampled" ? "Sampled" : "Not sampled",
      ),
    ),
    pendingDocuments: compilation?.review.pendingSourceCount ?? 0,
    checksPassed,
    checksTotal: actionChecks.length,
    checksAttention,
    state,
    headline,
    detail,
    // Suppressed while a check covers the same fault in operator language.
    blockers: checksAttention > 0 ? [] : blockers,
    // The compiler and the context can reach the same advisory independently.
    warnings: [
      ...new Set([...(compilation?.warnings ?? []), ...ctx.submissionWarnings]),
    ],
  };
}

export function batchDryTons(batch: MemberCreditBatch): string {
  return formatTonnes(batch.appliedDryWeightTons, { digits: TONNE_DIGITS });
}
