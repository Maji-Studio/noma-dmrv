import { describe, expect, it } from "vitest";
import { makeContext, setDurabilityMeasurementSamplesEnabled } from "../../../tests/fixtures/submit-removal-orchestrator";
import { make1000YearSequestrationTemplate } from "../../../tests/fixtures/submit-removal-templates";
import { collectContextRemovalBlockers } from "./removal-blockers-gate";
import { REMOVAL_PREPARATION_BLOCKERS } from "./removal-submission-prepare";

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
