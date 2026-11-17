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
  it.each([false, true])("ties the error to its stored attempt (changed since review: %s)", async (changed) => {
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
    if (changed) expect(error).toBeInstanceOf(InterruptedRemovalChangedError);
    const summary = vi.mocked(appendSyncEvent).mock.calls.find(([, event]) =>
      event.operation === "removal:submit:attempt-summary");
    expect(summary?.[1].responsePayload).toMatchObject({
      attempt_id: (error as { attemptId: string }).attemptId,
      failure_kind: changed ? CHANGED_SINCE_REVIEW_FAILURE_KIND : null,
    });
  });
});
