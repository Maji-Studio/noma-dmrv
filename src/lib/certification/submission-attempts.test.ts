import { describe, expect, it } from "vitest";
import { deriveSubmissionAttempts, type AttemptEventInput } from "./submission-attempts";

let counter = 0;
function event(at: string, operation: string, status: "succeeded" | "failed", extra: Partial<AttemptEventInput> = {}): AttemptEventInput {
  counter += 1;
  return { id: `e${counter}`, operation, status, attemptedAt: at, createdAt: at, errorMessage: null, responsePayload: null, ...extra };
}
/** An attempt summary: stamped with the attempt's start, written when it ends. */
const summary = (start: string, end: string, status: "succeeded" | "failed", attemptId: string, errorMessage: string | null = null, failureKind: string | null = null) =>
  event(start, "removal:submit:attempt-summary", status, {
    createdAt: end, errorMessage, responsePayload: { attempt_id: attemptId, failure_kind: failureKind },
  });

const DRIFT = {
  creditBatchId: "cb-9", creditBatchCode: "CB-26-009", shared: false, sharedWith: null,
  differences: [{ field: "dryMass", isometric: { magnitude: 1200, unit: "kg" }, noma: { magnitude: 1150, unit: "kg" } }],
};
const driftEvent = (at: string, drift: unknown = DRIFT) =>
  event(at, "production-batch:drift:cb-9", "failed", { responsePayload: { drift } });

describe("deriveSubmissionAttempts", () => {
  it("is empty without attempt summaries", () => {
    expect(deriveSubmissionAttempts([driftEvent("2026-10-20T06:12:05Z")])).toEqual([]);
  });

  it("maps a submitted attempt", () => {
    const [attempt] = deriveSubmissionAttempts([summary("2026-10-20T06:12:00Z", "2026-10-20T06:13:10Z", "succeeded", "a1")]);
    expect(attempt).toMatchObject({ id: "a1", at: "2026-10-20T06:12:00.000Z", outcome: { kind: "submitted" } });
  });

  it("maps a drift stop with its saved figures and a no-answer attempt, newest first", () => {
    const attempts = deriveSubmissionAttempts([
      summary("2026-10-20T06:12:00Z", "2026-10-20T06:12:45Z", "failed", "a1", "unexpected", "no_answer"),
      summary("2026-10-27T11:05:00Z", "2026-10-27T11:05:04Z", "failed", "a2", "drift message"),
      driftEvent("2026-10-27T11:05:03Z"),
    ]);
    expect(attempts.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(attempts[0]).toMatchObject({ errorMessage: "drift message", outcome: { kind: "differs", creditBatchCode: "CB-26-009", shared: false } });
    expect(attempts[1].outcome).toEqual({ kind: "no-answer" });
  });

  it("keeps a drift event with the attempt that wrote it, not a neighbour", () => {
    const attempts = deriveSubmissionAttempts([
      summary("2026-10-20T06:12:00Z", "2026-10-20T06:12:30Z", "failed", "a1", "other"),
      summary("2026-10-27T11:05:00Z", "2026-10-27T11:05:04Z", "failed", "a2", "drift"),
      driftEvent("2026-10-27T11:05:03Z"),
    ]);
    expect(attempts[0].outcome.kind).toBe("differs");
    expect(attempts[1].outcome).toEqual({ kind: "failed", message: "other" });
  });

  it("correlates overlapping attempts by ID", () => {
    const attempts = deriveSubmissionAttempts([
      summary("2026-10-27T11:05:00Z", "2026-10-27T11:05:30Z", "failed", "a1", "other"),
      summary("2026-10-27T11:05:10Z", "2026-10-27T11:05:20Z", "failed", "a2", "drift"),
      driftEvent("2026-10-27T11:05:15Z", { ...DRIFT, attemptId: "a2" }),
    ]);
    expect(attempts[0]).toMatchObject({ id: "a2", outcome: { kind: "differs", attemptId: "a2" } });
    expect(attempts[1].outcome).toEqual({ kind: "failed", message: "other" });
  });

  it("assigns drift within the previous summary's slack to the next attempt by ID", () => {
    const attempts = deriveSubmissionAttempts([
      summary("2026-10-27T11:05:00Z", "2026-10-27T11:05:10Z", "failed", "a1", "other"),
      summary("2026-10-27T11:05:10.100Z", "2026-10-27T11:05:12Z", "failed", "a2", "drift"),
      driftEvent("2026-10-27T11:05:10.500Z", { ...DRIFT, attemptId: "a2" }),
    ]);
    expect(attempts[0]).toMatchObject({ id: "a2", outcome: { kind: "differs" } });
    expect(attempts[1].outcome).toEqual({ kind: "failed", message: "other" });
  });

  it("uses an ID even outside the time window and never lends an identified orphan", () => {
    const events = [
      summary("2026-10-27T11:05:00Z", "2026-10-27T11:05:10Z", "failed", "a1", "other"),
      driftEvent("2026-10-27T11:05:05Z", { ...DRIFT, attemptId: "orphan" }),
    ];
    expect(deriveSubmissionAttempts(events)[0].outcome.kind).toBe("failed");
    events.push(driftEvent("2026-10-27T12:00:00Z", { ...DRIFT, attemptId: "a1" }));
    expect(deriveSubmissionAttempts(events)[0].outcome.kind).toBe("differs");
  });

  it("does not hand a later out-of-attempt drift stop to the newest attempt", () => {
    const [attempt] = deriveSubmissionAttempts([
      summary("2026-10-27T11:05:00Z", "2026-10-27T11:05:30Z", "failed", "a1", "plain failure"),
      driftEvent("2026-10-27T12:00:00Z"),
    ]);
    expect(attempt.outcome).toEqual({ kind: "failed", message: "plain failure" });
  });

  it("does not donate an orphan attempt's events to an earlier attempt", () => {
    // A later attempt died before writing its summary; its drift event sits after the earlier attempt ended.
    const [attempt] = deriveSubmissionAttempts([
      summary("2026-10-27T11:05:00Z", "2026-10-27T11:05:10Z", "failed", "a1", "plain failure"),
      driftEvent("2026-10-27T11:20:03Z"),
    ]);
    expect(attempt.outcome.kind).toBe("failed");
  });

  it("falls back to a plain failure for a drift event saved before the figures were data", () => {
    const [attempt] = deriveSubmissionAttempts([
      summary("2026-10-27T11:05:00Z", "2026-10-27T11:05:04Z", "failed", "a2", "Credit batch X is registered with different figures."),
      driftEvent("2026-10-27T11:05:03Z", null),
    ]);
    expect(attempt.outcome).toEqual({ kind: "failed", message: "Credit batch X is registered with different figures." });
  });

  it("carries the shared Removal", () => {
    const [attempt] = deriveSubmissionAttempts([
      summary("2026-10-27T11:05:00Z", "2026-10-27T11:05:04Z", "failed", "a2", "m"),
      driftEvent("2026-10-27T11:05:03Z", { ...DRIFT, shared: true, sharedWith: { id: "rm-3", code: "RM-26-003" } }),
    ]);
    expect(attempt.outcome).toMatchObject({ kind: "differs", shared: true, sharedWith: { id: "rm-3", code: "RM-26-003" } });
  });
});
