import { CHANGED_SINCE_REVIEW_FAILURE_KIND } from "./interrupted-removal-copy";

export interface SubmissionFailureDetails {
  failureKind?: typeof CHANGED_SINCE_REVIEW_FAILURE_KIND | null;
  attemptId?: string;
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
    ...("failureKind" in error &&
      (error.failureKind === null || error.failureKind === CHANGED_SINCE_REVIEW_FAILURE_KIND)
      ? { failureKind: error.failureKind } : {}),
    ...("attemptId" in error && typeof error.attemptId === "string"
      ? { attemptId: error.attemptId } : {}),
  };
}
