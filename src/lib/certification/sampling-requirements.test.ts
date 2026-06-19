import { describe, expect, it } from "vitest";
import { deriveSamplingRequirement, type RunSampling } from "./sampling-requirements";

function runs(...sampleCounts: number[]): RunSampling[] {
  return sampleCounts.map((sampleCount, i) => ({
    runId: `run-${i + 1}`,
    runCode: `PR-${i + 1}`,
    sampleCount,
  }));
}

describe("deriveSamplingRequirement — Method A (every run, §8.3)", () => {
  it("requires every run sampled and reports the unsampled ones", () => {
    const r = deriveSamplingRequirement("method_a", runs(3, 0, 3, 0));
    expect(r.totalRuns).toBe(4);
    expect(r.sampledRuns).toBe(2);
    expect(r.requiredSampledRuns).toBe(4);
    expect(r.cadenceShortfall).toBe(2);
    expect(r.unsampledRequiredRunIds).toEqual(["run-2", "run-4"]);
    expect(r.met).toBe(false);
  });

  it("is met when every run carries at least one sample", () => {
    const r = deriveSamplingRequirement("method_a", runs(3, 4, 3));
    expect(r.requiredSampledRuns).toBe(3);
    expect(r.cadenceShortfall).toBe(0);
    expect(r.unsampledRequiredRunIds).toEqual([]);
    expect(r.met).toBe(true);
  });

  it("flags sampled runs that fall short of the ≥3-replicate minimum (§4)", () => {
    const r = deriveSamplingRequirement("method_a", runs(3, 2, 1));
    expect(r.underReplicatedRunIds).toEqual(["run-2", "run-3"]);
    // cadence is still met — every run has ≥1 sample
    expect(r.cadenceShortfall).toBe(0);
  });
});

describe("deriveSamplingRequirement — Method B (≥1 per 10 runs, §8.3.1.2)", () => {
  it("requires ceil(totalRuns / 10) sampled runs", () => {
    // 25 runs → ceil(25/10) = 3 required
    const r = deriveSamplingRequirement(
      "method_b",
      runs(...Array(25).fill(0)),
    );
    expect(r.requiredSampledRuns).toBe(3);
    expect(r.sampledRuns).toBe(0);
    expect(r.cadenceShortfall).toBe(3);
    expect(r.met).toBe(false);
    // No per-run obligation under Method B — any 1-in-10 satisfies the cadence.
    expect(r.unsampledRequiredRunIds).toEqual([]);
  });

  it("is met when the sampled-run count meets the 1/10 cadence", () => {
    // 12 runs → ceil(12/10) = 2 required; two runs sampled.
    const counts = [3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0];
    const r = deriveSamplingRequirement("method_b", runs(...counts));
    expect(r.totalRuns).toBe(12);
    expect(r.requiredSampledRuns).toBe(2);
    expect(r.sampledRuns).toBe(2);
    expect(r.cadenceShortfall).toBe(0);
    expect(r.met).toBe(true);
  });

  it("requires at least one sample once any run exists (≤10 runs → 1 required)", () => {
    const r = deriveSamplingRequirement("method_b", runs(0, 0, 0));
    expect(r.requiredSampledRuns).toBe(1);
    expect(r.cadenceShortfall).toBe(1);
    expect(r.met).toBe(false);
  });

  it("still flags under-replicated sampled runs under Method B", () => {
    const r = deriveSamplingRequirement("method_b", runs(2, 0, 0, 0, 0, 0, 0, 0, 0, 0));
    expect(r.sampledRuns).toBe(1);
    expect(r.requiredSampledRuns).toBe(1);
    expect(r.cadenceShortfall).toBe(0);
    expect(r.met).toBe(true);
    expect(r.underReplicatedRunIds).toEqual(["run-1"]);
  });
});

describe("deriveSamplingRequirement — empty run set", () => {
  it("requires nothing and is met when there are no runs", () => {
    for (const method of ["method_a", "method_b"] as const) {
      const r = deriveSamplingRequirement(method, []);
      expect(r.totalRuns).toBe(0);
      expect(r.requiredSampledRuns).toBe(0);
      expect(r.cadenceShortfall).toBe(0);
      expect(r.met).toBe(true);
      expect(r.unsampledRequiredRunIds).toEqual([]);
      expect(r.underReplicatedRunIds).toEqual([]);
    }
  });
});
