import type { StatusValue } from "@/components/ui/status-badge";
import type { CreditBatchHealthSummary } from "@/fn/certification";

export const CREDIT_BATCH_LIFECYCLE_STEPS = [
  { key: "open", label: "Open" },
  { key: "removal-submitted", label: "Removal submitted" },
  { key: "verified", label: "Verified" },
  { key: "credits-issued", label: "Credits issued" },
] as const;

export type CreditBatchLifecycleStepState =
  | "active"
  | "success"
  | "inactive"
  | "failed";

export interface CreditBatchLifecycle {
  badgeStatus: StatusValue;
  label: string;
  currentStepIndex: number;
  stepStates: CreditBatchLifecycleStepState[];
}

function buildStepStates(
  currentStepIndex: number,
  currentState: "active" | "success" | "failed" = "active",
): CreditBatchLifecycleStepState[] {
  return CREDIT_BATCH_LIFECYCLE_STEPS.map((_, index) =>
    index === currentStepIndex ? currentState : "inactive",
  );
}

function statementLifecycle(
  summary: CreditBatchHealthSummary,
): CreditBatchLifecycle | null {
  const status = summary.ghgStatementStatus;
  if (!status) return null;

  switch (status.label) {
    case "In progress":
      return {
        badgeStatus: "running",
        label: "Updating statement",
        currentStepIndex: 1,
        stepStates: buildStepStates(1),
      };
    case "Draft":
      return {
        badgeStatus: "running",
        label: "Removal submitted",
        currentStepIndex: 1,
        stepStates: buildStepStates(1),
      };
    case "In registry":
      return {
        badgeStatus: "running",
        label: "Removal submitted",
        currentStepIndex: 1,
        stepStates: buildStepStates(1),
      };
    case "In verification":
      return {
        badgeStatus: "pending",
        label: "In verification",
        currentStepIndex: 1,
        stepStates: buildStepStates(1),
      };
    case "Verified":
      return {
        badgeStatus: "verified",
        label: "Verified",
        currentStepIndex: 2,
        stepStates: buildStepStates(2, "success"),
      };
    case "Issued":
      return {
        badgeStatus: "issued",
        label: "Credits issued",
        currentStepIndex: 3,
        stepStates: buildStepStates(3, "success"),
      };
    case "Verification failed":
      return {
        badgeStatus: "rejected",
        label: "Verification failed",
        currentStepIndex: 2,
        stepStates: buildStepStates(2, "failed"),
      };
    case "Superseded":
      return {
        badgeStatus: "superseded",
        label: "Statement superseded",
        currentStepIndex: 1,
        stepStates: buildStepStates(1),
      };
    default:
      return null;
  }
}

function removalLifecycle(
  summary: CreditBatchHealthSummary,
): CreditBatchLifecycle | null {
  const status = summary.removalStatus;
  if (!summary.removalId || !status) return null;

  switch (status.label) {
    case "Not submitted":
      return {
        badgeStatus: "draft",
        label: "Open",
        currentStepIndex: 0,
        stepStates: buildStepStates(0),
      };
    case "In progress":
      return {
        badgeStatus: "running",
        label: "Submitting removal",
        currentStepIndex: 0,
        stepStates: buildStepStates(0),
      };
    case "Submitted":
      return {
        badgeStatus: "running",
        label: "Removal submitted",
        currentStepIndex: 1,
        stepStates: buildStepStates(1),
      };
    case "Rejected":
      return {
        badgeStatus: "rejected",
        label: "Removal rejected",
        currentStepIndex: 0,
        stepStates: buildStepStates(0, "failed"),
      };
    case "Superseded":
      return {
        badgeStatus: "superseded",
        label: "Removal superseded",
        currentStepIndex: 1,
        stepStates: buildStepStates(1),
      };
    default:
      return null;
  }
}

export function deriveCreditBatchLifecycle(
  summary: CreditBatchHealthSummary,
): CreditBatchLifecycle {
  const statement = statementLifecycle(summary);
  if (statement) return statement;

  const removal = removalLifecycle(summary);
  if (removal) return removal;

  return {
    badgeStatus: summary.state === "ready" ? "draft" : "pending",
    label: "Open",
    currentStepIndex: 0,
    stepStates: buildStepStates(0),
  };
}
