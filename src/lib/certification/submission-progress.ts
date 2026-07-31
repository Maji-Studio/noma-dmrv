import type {
  SubmitGhgStatementDialogInput,
  SubmitRemovalInput,
} from "@/schemas/certification";

export const SUBMISSION_STREAM_PING_INTERVAL_MS = 15_000;
export const SUBMISSION_STREAM_READ_TIMEOUT_MS = 60_000;

export const REMOVAL_PROGRESS_STEPS = [
  "removal.checking_data",
  "removal.preparing_evidence",
  "removal.sending_inputs",
  "removal.sending_durability",
  "removal.creating",
  "removal.verifying_evidence",
  "removal.complete",
] as const;

export const GHG_STATEMENT_PROGRESS_STEPS = [
  "ghg_statement.checking",
  "ghg_statement.preparing_report",
  "ghg_statement.sending",
  "ghg_statement.confirming",
  "ghg_statement.complete",
] as const;

export type RemovalProgressStep = (typeof REMOVAL_PROGRESS_STEPS)[number];
export type GhgStatementProgressStep =
  (typeof GHG_STATEMENT_PROGRESS_STEPS)[number];
export type SubmissionProgressStep =
  | RemovalProgressStep
  | GhgStatementProgressStep;

export type SubmissionProgressState =
  | "active"
  | "complete"
  | "reused"
  | "skipped";

export interface SubmissionProgressUpdate {
  step: SubmissionProgressStep;
  state: SubmissionProgressState;
  completed?: number;
  total?: number;
}

export type SubmissionProgressReporter = (
  update: SubmissionProgressUpdate,
) => void;

export type SubmissionProgressRequest =
  | { kind: "removal"; input: SubmitRemovalInput }
  | {
      kind: "ghg_statement";
      ghgStatementId: string;
      input: SubmitGhgStatementDialogInput;
    };

export type SubmissionProgressStreamEvent<T> =
  | { type: "ping" }
  | { type: "progress"; update: SubmissionProgressUpdate }
  | { type: "result"; result: T }
  | { type: "error"; error: string };
