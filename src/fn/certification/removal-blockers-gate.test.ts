import { describe, expect, it, vi } from "vitest";
import { makeContext, REMOVAL_ID, setDurabilityMeasurementSamplesEnabled } from "../../../tests/fixtures/submit-removal-orchestrator";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { make1000YearSequestrationTemplate } from "../../../tests/fixtures/submit-removal-templates";
import { reviewedTemplateSources } from "../../../tests/helpers/template-line-sources";
import * as build from "./removal-submission-build";
import { env } from "@/config/env";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import { submitRemoval } from "./submit-removal";
import { SafeError } from "@/lib/errors";
import { describeFeedstockTypeMappingGap } from "@/lib/certification/feedstock-type-mapping";
import { collectContextRemovalBlockers, evaluateRemovalBlockers, firstSubmitBlockerMessage } from "./removal-blockers-gate";
import { prepareRemovalSubmission, REMOVAL_PREPARATION_BLOCKERS } from "./removal-submission-prepare";
import { assertEntityReadinessGapsResolved, buildRemovalSubmissionBuild, removalTemplateTierCompatibilityBlocker } from "./removal-submission-build";
import { assertSupportedDurabilityConfiguration } from "./durability-measurement-samples";
import * as ledger from "@/data-access/certification";
import * as claims from "@/data-access/certification-submissions";
import * as evidence from "./ensure-evidence-ledgers";
import * as mirror from "./sources-mirror-core";
import { createDatapoint, createGhgEntry } from "@/lib/isometric";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import { deriveRemovalReadiness } from "@/lib/certification/readiness";

const orgCtx = makeTestOrgContext();
const mappingGap = { creditBatchId: "batch", creditBatchCode: "CB-1", feedstockTypeId: "type", feedstockTypeName: "Wood" };

// Frozen pre-refactor data-check sequence, including its first-failure build.
async function oldFirstMessage(ctx: ReturnType<typeof makeContext>) {
  try {
    if (ctx.feedstockTypeMappingGaps.length) throw new SafeError(ctx.feedstockTypeMappingGaps.map(describeFeedstockTypeMappingGap).join(" "));
    assertEntityReadinessGapsResolved(ctx.entityReadinessGaps);
    const preparation = prepareRemovalSubmission(ctx);
    if (!preparation.prepared) throw new SafeError(preparation.blockers[0]?.message ?? REMOVAL_PREPARATION_BLOCKERS.noTemplate);
    const { prepared } = preparation;
    const message = firstSubmitBlockerMessage(preparation.blockers, removalTemplateTierCompatibilityBlocker(ctx, prepared.removalTemplate));
    if (message) throw new SafeError(message);
    if (prepared.hasDurabilityComponents) assertSupportedDurabilityConfiguration(ctx.batchesWithSamples);
    if (!ctx.memberBatches.length) throw new SafeError("This Removal has no credit batches.");
    if (!ctx.batchesWithSamples[0]?.durabilityOption) throw new SafeError("Facility durability tier could not be resolved. Reload and retry.");
    await buildRemovalSubmissionBuild({ orgCtx, removalId: REMOVAL_ID, ctx, prepared, sourceIds: [] });
    return undefined;
  } catch (error) {
    if (!(error instanceof SafeError)) throw error;
    return error.message;
  }
}

describe("Removal preflight", () => {
  it.each([
    ["happy path", () => makeContext()],
    ["mapping before entity", () => makeContext(undefined, { feedstockTypeMappingGaps: [mappingGap], entityReadinessGaps: ["Record Sample moisture"] })],
    ["template", () => makeContext(undefined, { removalTemplate: null })],
    ["unresolved tier", () => makeContext(undefined, { batchesWithSamples: [] })],
    ["entity evidence", () => makeContext(undefined, { entityReadinessGaps: ["Record Sample moisture"] })],
    ["delivery evidence", () => makeContext(undefined, { submissionLineageBlockers: [{ detail: "Delivery DL-1 has no proof of delivery.", fixTarget: "deliveryEvidence", record: { id: "delivery", code: "DL-1" } }] })],
    ["missing mass", () => { const ctx = makeContext(); ctx.runs[0].biocharDryMassKg = null; return ctx; }],
    ["missing runs", () => makeContext(undefined, { runs: [] })],
  ] as const)("preserves the first refusal: %s", async (_label, fixture) => {
    const ctx = fixture();
    const blockers = await evaluateRemovalBlockers({ orgCtx, removalId: REMOVAL_ID, ctx });
    expect(blockers[0]?.message).toBe(await oldFirstMessage(ctx));
    if (_label !== "happy path") expect(blockers.length).toBeGreaterThan(0);
    else expect(blockers).toEqual([]);
  });

  it("collects independent context failures in throw order and retains the Sample target", () => {
    const blockers = collectContextRemovalBlockers(makeContext(undefined, {
      feedstockTypeMappingGaps: [mappingGap], entityReadinessGaps: ["Record Sample moisture"],
      entityReadinessIssues: [{ key: "sampleMoisture", label: "Sample moisture", fixTarget: "labSamples", affectedRecords: [] }],
      batchesWithSamples: [],
    }));
    expect(blockers.map(({ code }) => code)).toEqual(["feedstockTypeMapping", "entityReadiness", "durabilityTier"]);
    expect(blockers[1].fixTarget).toBe("labSamples");
  });

  it("does not perform submission side effects even on a successful build", async () => {
    expect(await evaluateRemovalBlockers({ orgCtx, removalId: REMOVAL_ID, ctx: makeContext() })).toEqual([]);
    expect(claims.claimSubmissionDraft).not.toHaveBeenCalled();
    expect(ledger.appendSyncEvent).not.toHaveBeenCalled();
    expect(evidence.ensureEvidenceLedgersFromContext).not.toHaveBeenCalled();
    expect(mirror.mirrorCandidateSourcesForSubmission).not.toHaveBeenCalled();
    expect(createDatapoint).not.toHaveBeenCalled();
    expect(createGhgEntry).not.toHaveBeenCalled();
  });

  it("preserves tier mismatch precedence over durability availability and configuration", async () => {
    setDurabilityMeasurementSamplesEnabled(false);
    const ctx = makeContext();
    ctx.removalTemplate = make1000YearSequestrationTemplate();
    ctx.lineSources = reviewedTemplateSources(ctx.removalTemplate);
    const blockers = collectContextRemovalBlockers(ctx);
    expect(blockers[0].code).toBe("durabilityTier");
    expect(blockers.some((blocker) => blocker.code === "durabilityConfiguration")).toBe(true);
    expect(blockers[0].message).toBe(await oldFirstMessage(ctx));
  });

  it("runs the build with empty Sources only after a clear context and propagates unexpected errors", async () => {
    const spy = vi.spyOn(build, "buildRemovalSubmissionBuild");
    const failure = new Error("unexpected build failure");
    spy.mockRejectedValue(failure);
    await expect(evaluateRemovalBlockers({ orgCtx, removalId: REMOVAL_ID, ctx: makeContext() })).rejects.toBe(failure);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: [] }));
    spy.mockClear();
    await evaluateRemovalBlockers({ orgCtx, removalId: REMOVAL_ID, ctx: makeContext(undefined, { feedstockTypeMappingGaps: [mappingGap] }) });
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps production confirmation after context failures and before member/build failures", async () => {
    const previous = env.ISOMETRIC_ENVIRONMENT;
    env.ISOMETRIC_ENVIRONMENT = "production";
    try {
      const ctx = makeContext(undefined, { memberBatches: [], entityReadinessGaps: ["Record Sample moisture"] });
      vi.mocked(loadRemovalSubmissionContext).mockResolvedValue(ctx);
      await expect(submitRemoval({ orgCtx, removalId: REMOVAL_ID })).rejects.toThrow("Complete these fields before submitting the Removal:\nRecord Sample moisture");
      ctx.entityReadinessGaps = [];
      await expect(submitRemoval({ orgCtx, removalId: REMOVAL_ID })).rejects.toThrow("Confirm you want to write to the production Isometric environment.");
      await expect(submitRemoval({ orgCtx, removalId: REMOVAL_ID, confirmProduction: true })).rejects.toThrow("This Removal has no credit batches.");
    } finally {
      env.ISOMETRIC_ENVIRONMENT = previous;
    }
  });

  it("carries the tier compatibility refusal into readiness", () => {
    const ctx = makeContext();
    const message = removalTemplateTierCompatibilityBlocker(ctx, make1000YearSequestrationTemplate());
    expect(message).toBeTruthy();
    const facts = toRemovalReadinessFacts({ ...makeContext(), templateTierBlocker: message });
    expect(deriveRemovalReadiness(facts)).toMatchObject({ state: "blocked", reasons: expect.arrayContaining([message]) });
  });
});
