import type { CreditBatchHealthSummary } from "@/fn/certification";
import {
  getStatusState,
  type StatusStateClass,
} from "@/lib/status-state";
import {
  CREDIT_BATCH_LIFECYCLE_STEPS,
  deriveCreditBatchLifecycle,
  type CreditBatchLifecycleStepState,
} from "@/lib/certification/credit-batch-lifecycle";

const STEP_DOT_CLASSES: Record<CreditBatchLifecycleStepState, string> = {
  active: "border-[var(--st-run)] bg-[var(--st-run)]",
  success:
    "border-[var(--color-background-dark-light)] bg-[var(--color-background-dark-light)]",
  inactive:
    "border-[var(--st-off-border)] bg-[var(--color-background-white)]",
  failed:
    "border-[var(--st-bad)] bg-[var(--st-bad)]",
};

const STATUS_TEXT_CLASSES: Record<StatusStateClass, string> = {
  neutral: "text-[var(--color-text-secondary)]",
  "in-progress": "text-[var(--st-run)]",
  success: "text-[var(--st-ok)]",
  warning: "text-[var(--st-wait)]",
  error: "text-[var(--st-bad)]",
};

const ACTIVE_DOT_CLASSES: Record<StatusStateClass, string> = {
  neutral: "border-[var(--st-off)] bg-[var(--st-off)]",
  "in-progress": "border-[var(--st-run)] bg-[var(--st-run)]",
  success: "border-[var(--st-ok)] bg-[var(--st-ok)]",
  warning: "border-[var(--st-wait)] bg-[var(--st-wait)]",
  error: "border-[var(--st-bad)] bg-[var(--st-bad)]",
};

function StepMark({
  state,
  statusState,
}: {
  state: CreditBatchLifecycleStepState;
  statusState: StatusStateClass;
}) {
  const classes =
    state === "active"
      ? ACTIVE_DOT_CLASSES[statusState]
      : STEP_DOT_CLASSES[state];

  return (
    <span
      className={`inline-flex size-10 shrink-0 rounded-full border ${classes}`}
      aria-hidden
    />
  );
}

/**
 * The card rail's dots, promoted to a labelled journey for the side sheet.
 * The current step carries the derived lifecycle label (e.g. "In verification",
 * "Verification failed") so the rail states the batch's exact position, not
 * just which milestone it is nearest to.
 */
export function CreditBatchLifecycleSteps({
  summary,
}: {
  summary: CreditBatchHealthSummary;
}) {
  const lifecycle = deriveCreditBatchLifecycle(summary);
  const statusState = getStatusState(lifecycle.badgeStatus);

  return (
    <ol
      className="flex flex-wrap items-center gap-y-8"
      aria-label={`Certification progress: ${lifecycle.label}`}
    >
      {CREDIT_BATCH_LIFECYCLE_STEPS.map((step, index) => {
        const state = lifecycle.stepStates[index];
        const isCurrent = index === lifecycle.currentStepIndex;
        const label = isCurrent ? lifecycle.label : step.label;

        return (
          <li
            key={step.key}
            className="flex items-center"
            aria-current={isCurrent ? "step" : undefined}
          >
            {index > 0 && (
              <span
                className="mx-8 h-px w-12 shrink-0 bg-[var(--color-border-secondary)] sm:w-20"
                aria-hidden
              />
            )}
            <span className="flex items-center gap-6">
              <StepMark state={state} statusState={statusState} />
              <span
                className={`body-caption whitespace-nowrap ${
                  isCurrent
                    ? `font-medium ${STATUS_TEXT_CLASSES[statusState]}`
                    : state === "success"
                      ? "text-[var(--color-text-secondary)]"
                      : "text-[var(--color-text-tertiary)]"
                }`}
              >
                {label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function CreditBatchLifecycleRail({
  summary,
}: {
  summary: CreditBatchHealthSummary;
}) {
  const lifecycle = deriveCreditBatchLifecycle(summary);
  const statusState = getStatusState(lifecycle.badgeStatus);

  return (
    <div className="flex items-center justify-between gap-16">
      <div className="flex items-baseline gap-8">
        <span
          className={`body-small font-medium ${STATUS_TEXT_CLASSES[statusState]}`}
        >
          {lifecycle.label}
        </span>
        {lifecycle.label === "Open" && (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {summary.issueCount === 0
              ? "Ready to certify"
              : `${summary.issueCount} ${
                  summary.issueCount === 1 ? "issue" : "issues"
                } open`}
          </span>
        )}
      </div>
      <ol
        className="flex shrink-0 items-center"
        aria-label={`Certification progress: ${lifecycle.label}`}
      >
        {CREDIT_BATCH_LIFECYCLE_STEPS.map((step, index) => {
          const state = lifecycle.stepStates[index];
          const isCurrent = index === lifecycle.currentStepIndex;

          return (
            <li
              key={step.key}
              className="flex items-center"
              aria-label={step.label}
              aria-current={isCurrent ? "step" : undefined}
            >
              {index > 0 && (
                <span
                  className="h-px w-16 bg-[var(--color-border-secondary)]"
                  aria-hidden
                />
              )}
              <StepMark state={state} statusState={statusState} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
