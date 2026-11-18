import type { StatusValue } from "@/components/ui/status-badge";
import type { CreditBatchHealthSummary } from "@/fn/certification";
import { REMOVAL_SUBMISSION_INTERRUPTED_LABEL } from "./status";

export const CREDIT_BATCH_READY_LABEL = "Batch data ready";

export const CREDIT_BATCH_LIFECYCLE_STEPS = [
  { key: "open", label: "Open" },
  { key: "removal-submitted", label: "Removal submitted" },
  { key: "verified", label: "Verified" },
  { key: "credits-issued", label: "Credits issued" },
] as const;

export type CreditBatchLifecycleStep = typeof CREDIT_BATCH_LIFECYCLE_STEPS[number]["key"];

export type CreditBatchLifecycleStepState =
  | "active"
  | "success"
  | "inactive"
  | "failed";

export interface CreditBatchLifecycle {
  badgeStatus: StatusValue;
  label: string;
  currentStep: CreditBatchLifecycleStep;
  currentStepFailed: boolean;
  stepStates: CreditBatchLifecycleStepState[];
}

function lifecycleAtStep(
  badgeStatus: StatusValue,
  label: string,
  currentStep: CreditBatchLifecycleStep,
  currentState: "active" | "success" | "failed" = "active",
): CreditBatchLifecycle {
  const currentStepIndex = CREDIT_BATCH_LIFECYCLE_STEPS.findIndex((step) => step.key === currentStep);
  return {
    badgeStatus,
    label,
    currentStep,
    currentStepFailed: currentState === "failed",
    stepStates: CREDIT_BATCH_LIFECYCLE_STEPS.map((_, index) => {
      if (index < currentStepIndex) return "success";
      return index === currentStepIndex ? currentState : "inactive";
    }),
  };
}

function readyToSubmitLifecycle(): CreditBatchLifecycle {
  return lifecycleAtStep("ready", CREDIT_BATCH_READY_LABEL, "open", "success");
}

function statementLifecycle(
  summary: CreditBatchHealthSummary,
): CreditBatchLifecycle | null {
  const status = summary.ghgStatementStatus;
  if (!status) return null;

  switch (status.kind) {
    case "in-progress":
      return lifecycleAtStep("running", "Updating statement", "removal-submitted");
    case "draft":
      return lifecycleAtStep("running", "Removal submitted", "removal-submitted");
    case "in-registry":
      return lifecycleAtStep("running", "Removal submitted", "removal-submitted");
    case "pending-changes":
      return lifecycleAtStep("pending", "Statement pending changes", "removal-submitted");
    case "in-verification":
      return lifecycleAtStep("pending", "In verification", "removal-submitted");
    case "verified":
      return lifecycleAtStep("verified", "Verified", "verified", "success");
    case "issued":
      return lifecycleAtStep("issued", "Credits issued", "credits-issued", "success");
    case "verification-failed":
      return lifecycleAtStep("rejected", "Verification failed", "verified", "failed");
    case "superseded":
      return lifecycleAtStep("superseded", "Statement superseded", "removal-submitted");
    default:
      return null;
  }
}

function interruptedLifecycle(): CreditBatchLifecycle {
  return lifecycleAtStep("failed", REMOVAL_SUBMISSION_INTERRUPTED_LABEL, "open", "failed");
}

function removalLifecycle(
  summary: CreditBatchHealthSummary,
): CreditBatchLifecycle | null {
  const status = summary.removalStatus;
  if (!summary.removalId || !status) return null;

  switch (status.kind) {
    case "not-submitted":
      return summary.state === "ready"
        ? readyToSubmitLifecycle()
        : lifecycleAtStep("draft", "Open", "open");
    case "in-progress":
      return lifecycleAtStep("running", "Submitting Removal", "open");
    case "interrupted":
      return interruptedLifecycle();
    case "submitted":
      return lifecycleAtStep("running", "Removal submitted", "removal-submitted");
    case "rejected":
      return lifecycleAtStep("rejected", "Removal rejected", "open", "failed");
    case "superseded":
      return lifecycleAtStep("superseded", "Removal superseded", "removal-submitted");
    default:
      return null;
  }
}

export function deriveCreditBatchLifecycle(
  summary: CreditBatchHealthSummary,
): CreditBatchLifecycle {
  // The batch-level rule (`findInterruptedRemoval`): any interrupted holder wins, as on the list and timeline.
  if (summary.removalInterrupted) return interruptedLifecycle();
  const statement = statementLifecycle(summary);
  if (statement) return statement;

  if (summary.hasSubmittedRemoval) {
    return lifecycleAtStep("running", "Removal submitted", "removal-submitted");
  }

  const removal = removalLifecycle(summary);
  if (removal) return removal;

  if (summary.state === "ready") {
    return readyToSubmitLifecycle();
  }

  return lifecycleAtStep("pending", "Open", "open");
}
