import { describe, expect, it } from "vitest";
import {
  deriveSamplingRequirement,
  type BatchSampling,
} from "./sampling-requirements";

function batches(...sampleCounts: number[]): BatchSampling[] {
  return sampleCounts.map((sampleCount, i) => ({
    batchId: `batch-${i + 1}`,
    batchCode: `CB-${i + 1}`,
    sampleCount,
  }));
}

describe("deriveSamplingRequirement — Method A (every batch, §8.3)", () => {
  it("requires every batch sampled and reports the unsampled ones", () => {
    const r = deriveSamplingRequirement("method_a", batches(3, 0, 3, 0));
    expect(r.totalBatches).toBe(4);
    expect(r.sampledBatches).toBe(2);
    expect(r.requiredSampledBatches).toBe(4);
    expect(r.cadenceShortfall).toBe(2);
    expect(r.unsampledRequiredBatchIds).toEqual(["batch-2", "batch-4"]);
    expect(r.met).toBe(false);
  });

  it("is met when every batch carries at least one sample", () => {
    const r = deriveSamplingRequirement("method_a", batches(3, 4, 3));
    expect(r.requiredSampledBatches).toBe(3);
    expect(r.cadenceShortfall).toBe(0);
    expect(r.unsampledRequiredBatchIds).toEqual([]);
    expect(r.met).toBe(true);
  });

  it("flags sampled batches whose POOLED replicates fall short of ≥3 (§4)", () => {
    // The pooled count is per BATCH, not per run: a batch pooling 2 replicates
    // is under-replicated; one pooling 3 across 3 runs would not be (regression
    // against the old per-run over-requirement).
    const r = deriveSamplingRequirement("method_a", batches(3, 2, 1));
    expect(r.underReplicatedBatchIds).toEqual(["batch-2", "batch-3"]);
    // cadence is still met — every batch has ≥1 sample
    expect(r.cadenceShortfall).toBe(0);
  });
});

describe("deriveSamplingRequirement — Method B (≥1 per 10 batches, §8.3.1.2)", () => {
  it("requires ceil(totalBatches / 10) sampled batches", () => {
    // 25 batches → ceil(25/10) = 3 required
    const r = deriveSamplingRequirement(
      "method_b",
      batches(...Array(25).fill(0)),
    );
    expect(r.requiredSampledBatches).toBe(3);
    expect(r.sampledBatches).toBe(0);
    expect(r.cadenceShortfall).toBe(3);
    expect(r.met).toBe(false);
    // No per-batch obligation under Method B — any 1-in-10 satisfies the cadence.
    expect(r.unsampledRequiredBatchIds).toEqual([]);
  });

  it("is met when the sampled-batch count meets the 1/10 cadence", () => {
    // 12 batches → ceil(12/10) = 2 required; two batches sampled.
    const counts = [3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0];
    const r = deriveSamplingRequirement("method_b", batches(...counts));
    expect(r.totalBatches).toBe(12);
    expect(r.requiredSampledBatches).toBe(2);
    expect(r.sampledBatches).toBe(2);
    expect(r.cadenceShortfall).toBe(0);
    expect(r.met).toBe(true);
  });

  it("requires at least one sample once any batch exists (≤10 → 1 required)", () => {
    const r = deriveSamplingRequirement("method_b", batches(0, 0, 0));
    expect(r.requiredSampledBatches).toBe(1);
    expect(r.cadenceShortfall).toBe(1);
    expect(r.met).toBe(false);
  });

  it("still flags under-replicated sampled batches under Method B", () => {
    const r = deriveSamplingRequirement(
      "method_b",
      batches(2, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    );
    expect(r.sampledBatches).toBe(1);
    expect(r.requiredSampledBatches).toBe(1);
    expect(r.cadenceShortfall).toBe(0);
    expect(r.met).toBe(true);
    expect(r.underReplicatedBatchIds).toEqual(["batch-1"]);
  });
});

describe("deriveSamplingRequirement — empty batch set", () => {
  it("requires nothing and is met when there are no batches", () => {
    for (const method of ["method_a", "method_b"] as const) {
      const r = deriveSamplingRequirement(method, []);
      expect(r.totalBatches).toBe(0);
      expect(r.requiredSampledBatches).toBe(0);
      expect(r.cadenceShortfall).toBe(0);
      expect(r.met).toBe(true);
      expect(r.unsampledRequiredBatchIds).toEqual([]);
      expect(r.underReplicatedBatchIds).toEqual([]);
    }
  });
});
