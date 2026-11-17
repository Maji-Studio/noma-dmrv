import { describe, expect, it } from "vitest";
import { makeContext, REMOVAL_ID, USER_ID, setDurabilityMeasurementSamplesEnabled } from "../../../tests/fixtures/submit-removal-orchestrator";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { appendSyncEvent } from "@/data-access/certification";
import { loadRemovalSubmissionContext } from "@/lib/certification/certify-context-core";
import { CHANGED_SINCE_REVIEW_FAILURE_KIND, InterruptedRemovalChangedError } from "@/lib/certification/interrupted-removal-copy";
import { vi } from "vitest";
import { submitRemoval } from "./submit-removal";
import { make1000YearSequestrationTemplate } from "../../../tests/fixtures/submit-removal-templates";
import { collectContextRemovalBlockers } from "./removal-blockers-gate";
import { REMOVAL_PREPARATION_BLOCKERS } from "@/lib/certification/removal-submission-prepare";
import { SafeError } from "@/lib/errors";
import { DomainError } from "@/lib/domain-errors";
import { ISOMETRIC_REQUEST_TIMEOUT_MESSAGE, IsometricApiError } from "@/lib/isometric/client";
import { z } from "zod";
import { getSubmissionFailureDetails } from "@/lib/certification/submission-error";
import { submissionStreamErrorMessage } from "@/lib/certification/submission-stream-error";

const STORED_UNEXPECTED_ERROR_MESSAGE = "Removal submission failed unexpectedly. Submit the Removal again.";

function tierMismatchContext() {
  const ctx = makeContext(undefined, { removalTemplate: make1000YearSequestrationTemplate() });
  return ctx;
}

describe("collectContextRemovalBlockers submit precedence", () => {
  it("returns no blockers when nothing blocks", () => {
    expect(collectContextRemovalBlockers(makeContext())).toEqual([]);
  });

  it("surfaces the tier mismatch even when durability support is off", () => {
    // PR #840: tier repair must never be masked by durability availability.
    setDurabilityMeasurementSamplesEnabled(false);
    const blockers = collectContextRemovalBlockers(tierMismatchContext());
    expect(blockers[0].code).toBe("durabilityTier");
    expect(blockers[0].message).toContain("This facility uses 200-year durability");
    expect(blockers[1]).toMatchObject({ message: REMOVAL_PREPARATION_BLOCKERS.durabilityUnavailable, fixTarget: null });
  });

  it("still surfaces durability-unavailable when the tier matches", () => {
    setDurabilityMeasurementSamplesEnabled(false);
    const ctx = tierMismatchContext();
    ctx.batchesWithSamples[0].durabilityOption = "1000_year";
    expect(collectContextRemovalBlockers(ctx)[0]).toMatchObject({ message: REMOVAL_PREPARATION_BLOCKERS.durabilityUnavailable, fixTarget: null });
  });

  it("keeps template-shape blockers ahead of the tier guard", () => {
    setDurabilityMeasurementSamplesEnabled(false);
    const ctx = tierMismatchContext();
    ctx.removalTemplate!.credit_type = "REDUCTION";
    const blockers = collectContextRemovalBlockers(ctx);
    expect(blockers.slice(0, 3).map((blocker) => blocker.message)).toEqual([
      REMOVAL_PREPARATION_BLOCKERS.notRemovalTemplate,
      expect.stringContaining("This facility uses 200-year durability"),
      REMOVAL_PREPARATION_BLOCKERS.durabilityUnavailable,
    ]);
  });

  it("surfaces the tier guard alone when prepare finds no blockers", () => {
    setDurabilityMeasurementSamplesEnabled(true);
    expect(collectContextRemovalBlockers(tierMismatchContext())[0]).toMatchObject({ code: "durabilityTier" });
  });
});

describe("submitRemoval failure details", () => {
  it.each([
    { errorClass: "SafeError refusal", changed: false },
    { errorClass: "InterruptedRemovalChangedError", changed: true },
  ])("$errorClass receives an attempt id and its failure kind", async ({ changed }) => {
    vi.mocked(loadRemovalSubmissionContext).mockResolvedValue(makeContext(undefined, {
      latestSubmission: changed ? {
        status: "draft", externalId: "rmv-1", metadata: null,
      } as ReturnType<typeof makeContext>["latestSubmission"] : null,
      templateBlockers: [{ code: "notRemovalTemplate", message: "The template settings changed." }],
    }));
    const error = await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID, confirmProduction: true,
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({
      attemptId: expect.any(String),
      failureKind: changed ? CHANGED_SINCE_REVIEW_FAILURE_KIND : null,
    });
    expect(Object.keys(error as object)).not.toContain("attemptId");
    expect(Object.keys(error as object)).not.toContain("failureKind");
    expect(error).toBeInstanceOf(SafeError);
    if (changed) expect(error).toBeInstanceOf(InterruptedRemovalChangedError);
    const summary = vi.mocked(appendSyncEvent).mock.calls.find(([, event]) =>
      event.operation === "removal:submit:attempt-summary");
    expect(summary?.[1].responsePayload).toMatchObject({
      attempt_id: (error as { attemptId: string }).attemptId,
      failure_kind: changed ? CHANGED_SINCE_REVIEW_FAILURE_KIND : null,
    });
  });

  it.each([
    { errorClass: "DomainError", safe: new DomainError("validation_failed", "The template settings changed."), storedKind: null },
    {
      errorClass: "SafeError with a no-answer cause",
      safe: Object.assign(new SafeError("The provider did not answer."), {
        cause: new IsometricApiError("Network failure", undefined, undefined, "network"),
      }),
      storedKind: "no_answer",
    },
  ])("$errorClass receives an attempt id", async ({ safe, storedKind }) => {
    vi.mocked(loadRemovalSubmissionContext).mockRejectedValue(safe);
    const error = await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID, confirmProduction: true,
    }).catch((error: unknown) => error);
    expect(error).toBe(safe);
    expect(error).toHaveProperty("attemptId", expect.any(String));
    expect(error).toHaveProperty("failureKind", null);
    const summary = vi.mocked(appendSyncEvent).mock.calls.find(([, event]) =>
      event.operation === "removal:submit:attempt-summary");
    expect(summary?.[1].responsePayload).toMatchObject({
      attempt_id: (error as { attemptId: string }).attemptId,
      error_class: "SafeError",
      error_message: safe.message,
      failure_kind: storedKind,
    });
  });

  it("rethrows a frozen SafeError as the same object", async () => {
    const safe = Object.freeze(new SafeError("The template settings changed."));
    vi.mocked(loadRemovalSubmissionContext).mockRejectedValue(safe);
    await expect(submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID, confirmProduction: true,
    })).rejects.toBe(safe);
  });

  it.each([
    { errorClass: "unexpected Error", unexpected: new Error("Internal failure details"), storedKind: null },
    { errorClass: "unexpected Error matching the stored summary", unexpected: new Error(STORED_UNEXPECTED_ERROR_MESSAGE), storedKind: null },
    { errorClass: "ZodError", unexpected: new z.ZodError([{ code: "custom", path: [], message: "Invalid submission" }]), storedKind: null },
    { errorClass: "IsometricApiError with no answer", unexpected: new IsometricApiError("Network failure", undefined, undefined, "network"), storedKind: "no_answer" },
    { errorClass: "IsometricApiError with a read timeout", unexpected: new IsometricApiError("Read timed out", undefined, undefined, "http", "timeout"), storedKind: "no_answer" },
    { errorClass: "Error with a request timeout", unexpected: new Error(ISOMETRIC_REQUEST_TIMEOUT_MESSAGE), storedKind: "no_answer" },
  ])("$errorClass receives no attempt id", async ({ unexpected, storedKind }) => {
    vi.mocked(loadRemovalSubmissionContext).mockRejectedValue(unexpected);
    const error = await submitRemoval({
      orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID, confirmProduction: true,
    }).catch((error: unknown) => error);
    expect(error).toBe(unexpected);
    expect(error).not.toHaveProperty("attemptId");
    expect(error).toHaveProperty("failureKind", null);
    expect(getSubmissionFailureDetails(error)).toEqual({ failureKind: null });
    if (unexpected instanceof z.ZodError) {
      expect(submissionStreamErrorMessage(error)).toBe("Validation error: Invalid submission");
    }
    const summary = vi.mocked(appendSyncEvent).mock.calls.find(([, event]) =>
      event.operation === "removal:submit:attempt-summary");
    expect(summary?.[1].responsePayload).toMatchObject({
      attempt_id: expect.any(String),
      outcome: "failed",
      error_class: "UnexpectedError",
      error_message: STORED_UNEXPECTED_ERROR_MESSAGE,
      failure_kind: storedKind,
    });
  });

  it.each([null, undefined, "failure", 42, false, BigInt(1), Symbol("failure")])(
    "rethrows primitive failures untouched: %s",
    async (unexpected) => {
      vi.mocked(loadRemovalSubmissionContext).mockRejectedValue(unexpected);
      const error = await submitRemoval({
        orgCtx: makeTestOrgContext(USER_ID), removalId: REMOVAL_ID, confirmProduction: true,
      }).catch((error: unknown) => error);
      expect(error).toBe(unexpected);
      expect(getSubmissionFailureDetails(error)).toEqual({});
    },
  );
});
