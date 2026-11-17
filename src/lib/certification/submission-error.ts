import { CHANGED_SINCE_REVIEW_FAILURE_KIND } from "./interrupted-removal-copy";

export interface SubmissionFailureDetails {
  failureKind?: typeof CHANGED_SINCE_REVIEW_FAILURE_KIND | null;
  attemptId?: string;
}

export function isSubmissionFailureKind(
  value: unknown,
): value is Exclude<SubmissionFailureDetails["failureKind"], undefined> {
  return value === null || value === CHANGED_SINCE_REVIEW_FAILURE_KIND;
}

export function isSubmissionAttemptId(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export class SubmissionError extends Error implements SubmissionFailureDetails {
  readonly failureKind?: SubmissionFailureDetails["failureKind"];
  readonly attemptId?: string;

  constructor(message: string, details: SubmissionFailureDetails = {}) {
    super(message);
    this.name = "SubmissionError";
    this.failureKind = details.failureKind;
    this.attemptId = details.attemptId;
  }
}

export function getSubmissionFailureDetails(error: unknown): SubmissionFailureDetails {
  if (!(error instanceof Error)) return {};
  return {
    ...("failureKind" in error && isSubmissionFailureKind(error.failureKind)
      ? { failureKind: error.failureKind } : {}),
    ...("attemptId" in error && isSubmissionAttemptId(error.attemptId)
      ? { attemptId: error.attemptId } : {}),
  };
}
