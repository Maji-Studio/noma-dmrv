import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import {
  buildDurabilityBatchSummaries,
  type DurabilityBatchSummaryInput,
} from "./durability-batch-summary";

function sample(overrides: Partial<Sample>): Sample {
  return {
    id: "s",
    sampleCode: "S-00",
    samplingTime: new Date("2026-01-12T00:00:00.000Z"),
    productionRunId: "run-a",
    creditBatchId: "cb-a",
    labName: "Eurofins",
    hToCOrgRatio: null,
    oToCOrgRatio: null,
    totalCarbonPercent: null,
    organicCarbonPercent: null,
    inorganicCarbonPercent: null,
    ...overrides,
  } as unknown as Sample;
}

function batch(
  overrides: Partial<DurabilityBatchSummaryInput> &
    Pick<DurabilityBatchSummaryInput, "creditBatchId" | "creditBatchCode">,
): DurabilityBatchSummaryInput {
  return {
    samplingMethod: "method_a",
    samples: [],
    runs: [{ id: "run-a", code: "PR-A", biocharDryMassKg: 1000 }],
    ...overrides,
  };
}

// Three eligible replicates across three distinct days (the ready case).
function eligibleSamples(): Sample[] {
  return [
    sample({
      id: "s1",
      sampleCode: "S-A-01",
      productionRunId: "run-a",
      samplingTime: new Date("2026-01-12T00:00:00.000Z"),
      hToCOrgRatio: 0.3,
      oToCOrgRatio: 0.04,
      totalCarbonPercent: 80,
      organicCarbonPercent: 79,
      inorganicCarbonPercent: 1,
    }),
    sample({
      id: "s2",
      sampleCode: "S-A-02",
      productionRunId: "run-a",
      samplingTime: new Date("2026-01-13T00:00:00.000Z"),
      hToCOrgRatio: 0.32,
      oToCOrgRatio: 0.05,
      totalCarbonPercent: 82,
      organicCarbonPercent: 80,
      inorganicCarbonPercent: 2,
    }),
    sample({
      id: "s3",
      sampleCode: "S-A-03",
      productionRunId: "run-b",
      samplingTime: new Date("2026-01-14T00:00:00.000Z"),
      hToCOrgRatio: 0.34,
      oToCOrgRatio: 0.06,
      totalCarbonPercent: 84,
      organicCarbonPercent: 82,
      inorganicCarbonPercent: 2,
    }),
  ];
}

describe("buildDurabilityBatchSummaries", () => {
  it("reports a ready batch: ≥3 distributed eligible replicates", () => {
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        runs: [
          { id: "run-a", code: "PR-A", biocharDryMassKg: 1000 },
          { id: "run-b", code: "PR-B", biocharDryMassKg: 500 },
        ],
        samples: eligibleSamples(),
      }),
    ]);

    expect(summary.sampleCount).toBe(3);
    expect(summary.usableReplicateCount).toBe(3);
    expect(summary.meetsMinimum).toBe(true);
    expect(summary.minimumReplicates).toBe(3);
    expect(summary.distinctRunDayCount).toBe(3);
    expect(summary.distributionWarning).toBe(false);
    expect(summary.eligibility.eligible).toBe(true);
    // Submitted H/C_org mean of {0.3, 0.32, 0.34} = 0.32, with a real std-dev.
    expect(summary.submitted.hToCorg?.mean).toBeCloseTo(0.32, 5);
    expect(summary.submitted.hToCorg?.stdDev).not.toBeNull();
    // Product mass sums the member runs' dry mass (no attribution = full).
    expect(summary.submitted.productMassKg).toBe(1500);
    // Replicate rows carry resolved run codes.
    expect(summary.replicates.map((r) => r.productionRunCode)).toEqual([
      "PR-A",
      "PR-A",
      "PR-B",
    ]);
  });

  it("warns when ≥3 replicates cluster on a single run/day", () => {
    const clustered = eligibleSamples().map((s) =>
      sample({
        ...s,
        productionRunId: "run-a",
        samplingTime: new Date("2026-01-12T00:00:00.000Z"),
      }),
    );
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        samples: clustered,
      }),
    ]);

    expect(summary.meetsMinimum).toBe(true);
    expect(summary.distinctRunDayCount).toBe(1);
    expect(summary.distributionWarning).toBe(true);
  });

  it("does not raise the distribution warning below the ≥3 minimum", () => {
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        samples: eligibleSamples().slice(0, 2),
      }),
    ]);

    expect(summary.usableReplicateCount).toBe(2);
    expect(summary.meetsMinimum).toBe(false);
    expect(summary.distributionWarning).toBe(false);
  });

  it("flags ineligibility on the pooled mean breaching the ceiling", () => {
    const ineligible = eligibleSamples().map((s) =>
      sample({ ...s, hToCOrgRatio: 0.6 }),
    );
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        samples: ineligible,
      }),
    ]);

    expect(summary.eligibility.eligible).toBe(false);
    expect(summary.eligibility.hToCWithinThreshold).toBe(false);
  });

  it("marks an individual out-of-spec replicate as an outlier while the mean stays eligible", () => {
    const withOutlier = eligibleSamples();
    withOutlier[2] = sample({ ...withOutlier[2], hToCOrgRatio: 0.55 });
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        samples: withOutlier,
      }),
    ]);

    // mean of {0.3, 0.32, 0.55} = 0.39 < 0.5 → still eligible, but R3 is flagged.
    expect(summary.eligibility.eligible).toBe(true);
    expect(summary.replicates.map((r) => r.outlier)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("treats an unsampled batch as indeterminate with no submitted chemistry", () => {
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        runs: [{ id: "run-a", code: "PR-A", biocharDryMassKg: 1000 }],
        samples: [],
      }),
    ]);

    expect(summary.sampleCount).toBe(0);
    expect(summary.usableReplicateCount).toBe(0);
    expect(summary.meetsMinimum).toBe(false);
    expect(summary.eligibility.eligible).toBeNull();
    expect(summary.submitted.hToCorg).toBeNull();
    // Mass is independent of sampling — still summed from member runs.
    expect(summary.submitted.productMassKg).toBe(1000);
  });

  it("scales product mass by per-run attribution", () => {
    const [summary] = buildDurabilityBatchSummaries(
      [
        batch({
          creditBatchId: "cb-a",
          creditBatchCode: "CB-A",
          runs: [{ id: "run-a", code: "PR-A", biocharDryMassKg: 1000 }],
          samples: eligibleSamples(),
        }),
      ],
      new Map([["run-a", 0.25]]),
    );

    expect(summary.submitted.productMassKg).toBe(250);
  });

  it("derives inorganic carbon (Eq.2) for the submitted mean when unmeasured", () => {
    const derived = eligibleSamples().map((s) =>
      sample({ ...s, inorganicCarbonPercent: null }),
    );
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        samples: derived,
      }),
    ]);

    // max(0, total − organic): {1, 2, 2} → mean 1.667.
    expect(summary.submitted.inorganicCarbonPercent?.mean).toBeCloseTo(
      5 / 3,
      5,
    );
  });

  it("counts distribution over USABLE replicates only — an incomplete off-day sample can't mask a clustered set", () => {
    // 3 complete replicates clustered on one run/day + 1 incomplete (H/C only)
    // on a different day. The incomplete one must NOT add a phantom distinct key
    // (it would otherwise read as 2 distinct and suppress the cluster warning) —
    // this is the readiness mirror of the §8.3.1 gate fix (PR #296).
    const clustered = [0, 1, 2].map((i) =>
      sample({
        id: `c${i}`,
        sampleCode: `S-C-0${i}`,
        productionRunId: "run-a",
        samplingTime: new Date("2026-01-12T00:00:00.000Z"),
        hToCOrgRatio: 0.3,
        oToCOrgRatio: 0.05,
        totalCarbonPercent: 80,
        organicCarbonPercent: 79,
      }),
    );
    const incompleteOffDay = sample({
      id: "inc",
      sampleCode: "S-INC",
      productionRunId: "run-b",
      samplingTime: new Date("2026-02-01T00:00:00.000Z"),
      hToCOrgRatio: 0.3, // no O/C → not a usable paired replicate
    });

    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        samples: [...clustered, incompleteOffDay],
      }),
    ]);

    expect(summary.sampleCount).toBe(4);
    expect(summary.usableReplicateCount).toBe(3);
    expect(summary.distinctRunDayCount).toBe(1);
    expect(summary.distributionWarning).toBe(true);
  });

  it("handles string sampling timestamps for the distribution count", () => {
    const stringDays = eligibleSamples().map((s, i) =>
      sample({
        ...s,
        samplingTime: `2026-01-1${2 + i}T00:00:00.000Z` as unknown as Date,
      }),
    );
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        samples: stringDays,
      }),
    ]);

    expect(summary.distinctRunDayCount).toBe(3);
  });
});
