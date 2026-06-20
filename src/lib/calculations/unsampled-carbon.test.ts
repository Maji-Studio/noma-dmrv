import { describe, expect, it } from "vitest";
import {
  ELIGIBLE_SAMPLE_WINDOW_MONTHS,
  filterEligibleSamples,
  previewUnsampledCarbon,
  type EligibleSampleDatum,
} from "./unsampled-carbon";

const AS_OF = new Date("2026-06-20T00:00:00Z");

function sample(
  organicCarbonPercent: number | null,
  daysBeforeAsOf: number,
  creditBatchId: string | null = "cb-other",
): EligibleSampleDatum {
  const samplingTime = new Date(AS_OF);
  samplingTime.setDate(samplingTime.getDate() - daysBeforeAsOf);
  return { organicCarbonPercent, samplingTime, creditBatchId };
}

describe("filterEligibleSamples — trailing window + leave-one-out", () => {
  it("keeps samples within the 6-month window and drops older ones", () => {
    const samples = [
      sample(75, 1), // yesterday — in
      sample(75, 30), // a month ago — in
      sample(75, 200), // > 6 months — out
    ];
    const eligible = filterEligibleSamples(samples, { asOfDate: AS_OF });
    expect(eligible).toHaveLength(2);
  });

  it("excludes samples taken on/after the as-of date (must be BEFORE the batch)", () => {
    const onAsOf: EligibleSampleDatum = {
      organicCarbonPercent: 75,
      samplingTime: new Date(AS_OF),
      creditBatchId: "cb-other",
    };
    const future = sample(75, -5); // 5 days after as-of
    expect(
      filterEligibleSamples([onAsOf, future], { asOfDate: AS_OF }),
    ).toHaveLength(0);
  });

  it("applies leave-one-out for the excluded batch", () => {
    const samples = [
      sample(75, 5, "cb-self"),
      sample(76, 5, "cb-self"),
      sample(74, 5, "cb-other"),
    ];
    const eligible = filterEligibleSamples(samples, {
      asOfDate: AS_OF,
      excludeCreditBatchId: "cb-self",
    });
    expect(eligible).toHaveLength(1);
    expect(eligible[0].creditBatchId).toBe("cb-other");
  });

  it("honours a custom window length", () => {
    const samples = [sample(75, 45)]; // ~1.5 months ago
    expect(
      filterEligibleSamples(samples, { asOfDate: AS_OF, windowMonths: 1 }),
    ).toHaveLength(0);
    expect(
      filterEligibleSamples(samples, { asOfDate: AS_OF, windowMonths: 6 }),
    ).toHaveLength(1);
  });
});

describe("previewUnsampledCarbon — Eq 4/5 (μ − σ/√n)", () => {
  it("computes μ − σ/√n over the eligible pool", () => {
    // values 70, 80 → mean 75, sample stddev = sqrt(50) ≈ 7.0710678
    const samples = [sample(70, 10), sample(80, 20)];
    const result = previewUnsampledCarbon(samples, { asOfDate: AS_OF });

    const expectedStdDev = Math.sqrt(((70 - 75) ** 2 + (80 - 75) ** 2) / 1);
    const expectedSE = expectedStdDev / Math.sqrt(2);

    expect(result.meanOrganicCarbonPercent).toBeCloseTo(75, 10);
    expect(result.stdDevOrganicCarbonPercent).toBeCloseTo(expectedStdDev, 10);
    expect(result.standardError).toBeCloseTo(expectedSE, 10);
    expect(result.estimateOrganicCarbonPercent).toBeCloseTo(75 - expectedSE, 10);
    expect(result.eligibleSampleCount).toBe(2);
    expect(result.windowMonths).toBe(ELIGIBLE_SAMPLE_WINDOW_MONTHS);
    expect(result.authoritative).toBe(false);
  });

  it("estimate is always ≤ the mean (conservative haircut)", () => {
    const samples = [sample(70, 5), sample(75, 6), sample(80, 7), sample(72, 8)];
    const result = previewUnsampledCarbon(samples, { asOfDate: AS_OF });
    expect(result.estimateOrganicCarbonPercent).not.toBeNull();
    expect(result.meanOrganicCarbonPercent).not.toBeNull();
    expect(result.estimateOrganicCarbonPercent!).toBeLessThan(
      result.meanOrganicCarbonPercent!,
    );
  });

  it("returns no estimate (with a note) when the pool is empty", () => {
    const result = previewUnsampledCarbon([sample(75, 300)], {
      asOfDate: AS_OF,
    });
    expect(result.estimateOrganicCarbonPercent).toBeNull();
    expect(result.meanOrganicCarbonPercent).toBeNull();
    expect(result.eligibleSampleCount).toBe(0);
    expect(result.notes.join(" ")).toMatch(/no eligible samples/i);
  });

  it("returns the mean but no estimate for a single eligible sample", () => {
    const result = previewUnsampledCarbon([sample(75, 5)], { asOfDate: AS_OF });
    expect(result.meanOrganicCarbonPercent).toBe(75);
    expect(result.estimateOrganicCarbonPercent).toBeNull();
    expect(result.standardError).toBeNull();
    expect(result.eligibleSampleCount).toBe(1);
    expect(result.notes.join(" ")).toMatch(/standard error needs/i);
  });

  it("drops carbon-less eligible rows and notes the exclusion", () => {
    const samples = [sample(70, 5), sample(null, 6), sample(80, 7)];
    const result = previewUnsampledCarbon(samples, { asOfDate: AS_OF });
    expect(result.eligibleSampleCount).toBe(2);
    expect(result.notes.join(" ")).toMatch(/missing organic-carbon/i);
  });
});
