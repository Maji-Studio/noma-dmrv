import { describe, expect, it } from "vitest";
import { deriveSubmissionAttempts, type AttemptEventInput } from "./submission-attempts";

let counter = 0;
function event(at: string, operation: string, status: "succeeded" | "failed", extra: Partial<AttemptEventInput> = {}): AttemptEventInput {
  counter += 1;
  return { id: `e${counter}`, operation, status, attemptedAt: at, errorMessage: null, responsePayload: null, ...extra };
}
const summary = (at: string, status: "succeeded" | "failed", attemptId: string, errorMessage: string | null = null) =>
  event(at, "removal:submit:attempt-summary", status, { errorMessage, responsePayload: { attempt_id: attemptId } });

const DRIFT = {
  creditBatchId: "cb-9", creditBatchCode: "CB-26-009", shared: false, sharedWith: null,
  differences: [{ field: "dryMass", isometric: { magnitude: 1200, unit: "kg" }, noma: { magnitude: 1150, unit: "kg" } }],
};

describe("deriveSubmissionAttempts", () => {
  it("is empty without attempt summaries", () => {
    expect(deriveSubmissionAttempts([event("2026-10-20T06:12:05Z", "datapoint:create:x", "failed")])).toEqual([]);
  });

  it("maps a submitted attempt", () => {
    const [attempt] = deriveSubmissionAttempts([summary("2026-10-20T06:12:00Z", "succeeded", "a1")]);
    expect(attempt).toMatchObject({ id: "a1", at: "2026-10-20T06:12:00.000Z", outcome: { kind: "submitted" } });
  });

  it("maps a drift stop with its saved figures, newest attempt first", () => {
    const attempts = deriveSubmissionAttempts([
      summary("2026-10-20T06:12:00Z", "failed", "a1", "Removal submission failed unexpectedly. Retry the submission."),
      event("2026-10-20T06:12:40Z", "datapoint:create:x", "failed", { errorMessage: "Isometric request timed out" }),
      summary("2026-10-27T11:05:00Z", "failed", "a2", "drift message"),
      event("2026-10-27T11:05:03Z", "production-batch:drift:cb-9", "failed", { errorMessage: "drift message", responsePayload: { drift: DRIFT } }),
    ]);
    expect(attempts.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(attempts[0]).toMatchObject({ errorMessage: "drift message", outcome: { kind: "differs", creditBatchCode: "CB-26-009", shared: false } });
    expect(attempts[1].outcome).toEqual({ kind: "no-answer" });
  });

  it("keeps a drift event with the attempt that wrote it, not a neighbour", () => {
    const attempts = deriveSubmissionAttempts([
      summary("2026-10-20T06:12:00Z", "failed", "a1", "other"),
      summary("2026-10-27T11:05:00Z", "failed", "a2", "drift"),
      event("2026-10-27T11:05:03Z", "production-batch:drift:cb-9", "failed", { responsePayload: { drift: DRIFT } }),
    ]);
    expect(attempts[0].outcome.kind).toBe("differs");
    expect(attempts[1].outcome).toEqual({ kind: "failed", message: "other" });
  });

  it("falls back to a plain failure for a drift event saved before the figures were data", () => {
    const [attempt] = deriveSubmissionAttempts([
      summary("2026-10-27T11:05:00Z", "failed", "a2", "Credit batch X is registered with different figures."),
      event("2026-10-27T11:05:03Z", "production-batch:drift:cb-9", "failed", { responsePayload: { id: "ptb_1" } }),
    ]);
    expect(attempt.outcome).toEqual({ kind: "failed", message: "Credit batch X is registered with different figures." });
  });

  it("carries the shared Removal", () => {
    const [attempt] = deriveSubmissionAttempts([
      summary("2026-10-27T11:05:00Z", "failed", "a2", "m"),
      event("2026-10-27T11:05:03Z", "production-batch:drift:cb-9", "failed", {
        responsePayload: { drift: { ...DRIFT, shared: true, sharedWith: { id: "rm-3", code: "RM-26-003" } } },
      }),
    ]);
    expect(attempt.outcome).toMatchObject({ kind: "differs", shared: true, sharedWith: { id: "rm-3", code: "RM-26-003" } });
  });
});
