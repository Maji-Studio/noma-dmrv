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
  success: "border-[var(--st-ok)] bg-[var(--st-ok)]",
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
        {lifecycle.label === "Open" && summary.issueCount > 0 && (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {summary.issueCount} to complete
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
