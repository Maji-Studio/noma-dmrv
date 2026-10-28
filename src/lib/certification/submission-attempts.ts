/**
 * One entry per submit attempt, derived from the Removal's sync events.
 * `submitRemoval` writes a `removal:submit:attempt-summary` event as each
 * attempt ends, stamped with the attempt's start time. Every other event the
 * attempt wrote (a drift stop, a timed-out call) falls between that start and
 * the next attempt's start. An attempt that never ended (the server died) has
 * no summary, so it has no entry; the interrupted status covers that case.
 */
import type { DriftDetails } from "./production-batch-drift-details";
import { readDriftDetails } from "./production-batch-drift-details";

export const ATTEMPT_SUMMARY_OPERATION = "removal:submit:attempt-summary";
export const DRIFT_OPERATION_PREFIX = "production-batch:drift:";
const NO_ANSWER_PATTERN = /timed out|timeout|network|fetch failed|ECONN|ETIMEDOUT/i;

export type AttemptOutcome =
  | { kind: "submitted" }
  | ({ kind: "differs" } & DriftDetails)
  | { kind: "no-answer" }
  | { kind: "failed"; message: string | null };

export interface SubmissionAttempt {
  id: string;
  /** ISO time the attempt started. */
  at: string;
  outcome: AttemptOutcome;
  /** The error text the attempt ended with, so a surface can tell it from an older attempt's. */
  errorMessage: string | null;
}

/** The slice of a sync event the derivation reads. */
export interface AttemptEventInput {
  id: string;
  operation: string;
  status: string;
  attemptedAt: Date | string;
  errorMessage: string | null;
  responsePayload: unknown;
}

function time(value: Date | string): number {
  return new Date(value).getTime();
}

/** Newest first. */
export function deriveSubmissionAttempts(events: readonly AttemptEventInput[]): SubmissionAttempt[] {
  const summaries = events
    .filter((event) => event.operation === ATTEMPT_SUMMARY_OPERATION)
    .sort((a, b) => time(b.attemptedAt) - time(a.attemptedAt));
  const others = events.filter((event) => event.operation !== ATTEMPT_SUMMARY_OPERATION && event.status === "failed");

  return summaries.map((summary, index) => {
    const start = time(summary.attemptedAt);
    const end = index === 0 ? Number.POSITIVE_INFINITY : time(summaries[index - 1].attemptedAt);
    const payload = (summary.responsePayload ?? {}) as { attempt_id?: unknown };
    const id = typeof payload.attempt_id === "string" ? payload.attempt_id : summary.id;
    const base = { id, at: new Date(start).toISOString(), errorMessage: summary.errorMessage };
    if (summary.status === "succeeded") return { ...base, outcome: { kind: "submitted" } };

    const inWindow = others.filter((event) => time(event.attemptedAt) >= start && time(event.attemptedAt) < end);
    for (const event of inWindow) {
      if (!event.operation.startsWith(DRIFT_OPERATION_PREFIX)) continue;
      const details = readDriftDetails(event.responsePayload);
      if (details) return { ...base, outcome: { kind: "differs", ...details } };
    }
    if (inWindow.some((event) => NO_ANSWER_PATTERN.test(event.errorMessage ?? ""))) {
      return { ...base, outcome: { kind: "no-answer" } };
    }
    return { ...base, outcome: { kind: "failed", message: summary.errorMessage } };
  });
}
