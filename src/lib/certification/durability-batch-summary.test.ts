import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import {
  buildDurabilityBatchSummaries,
  summarizeFutureReplicates,
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

// The readiness surface must classify a sampling instant on the facility-LOCAL
// calendar day, matching the write guard (`assertSampleNotBeforeBatchWindow`)
// and the submission gate (`isoSamplingDay`) — otherwise the distribution/
// provenance evidence shown here diverges from what submission accepts (issue
// #455). Boundary cases across a positive- and a negative-offset facility.
describe("buildDurabilityBatchSummaries facility-local sampling day", () => {
  it("resolves the local day for a positive-offset facility (UTC+3)", () => {
    // Africa/Nairobi (UTC+3): 21:30Z on the 14th is 00:30 local on the 15th.
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        facilityTimezone: "Africa/Nairobi",
        endDate: "2026-01-31",
        samples: [
          sample({
            id: "s1",
            sampleCode: "S-A-01",
            samplingTime: new Date("2026-01-14T21:30:00.000Z"),
            hToCOrgRatio: 0.3,
            oToCOrgRatio: 0.04,
            totalCarbonPercent: 80,
            organicCarbonPercent: 79,
          }),
        ],
      }),
    ]);

    // Facility-local day, not the earlier UTC day 2026-01-14.
    expect(summary.replicates[0].samplingDay).toBe("2026-01-15");
  });

  it("resolves the local day for a negative-offset facility (UTC-8)", () => {
    // America/Los_Angeles (UTC-8): 03:30Z on the 15th is 19:30 local on the 14th.
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        facilityTimezone: "America/Los_Angeles",
        endDate: "2026-01-31",
        samples: [
          sample({
            id: "s1",
            sampleCode: "S-A-01",
            samplingTime: new Date("2026-01-15T03:30:00.000Z"),
            hToCOrgRatio: 0.3,
            oToCOrgRatio: 0.04,
            totalCarbonPercent: 80,
            organicCarbonPercent: 79,
          }),
        ],
      }),
    ]);

    // Facility-local day, not the later UTC day 2026-01-15.
    expect(summary.replicates[0].samplingDay).toBe("2026-01-14");
  });

  it("counts distinct run/day provenance in facility-local days (UTC-8)", () => {
    // Two run-a samples share the UTC day 2026-01-15 but fall on different LA
    // local days — the local classification yields 2 distinct keys, where a UTC
    // reading would collapse them to 1.
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        facilityTimezone: "America/Los_Angeles",
        endDate: "2026-01-31",
        samples: [
          sample({
            id: "s1",
            sampleCode: "S-A-01",
            productionRunId: "run-a",
            samplingTime: new Date("2026-01-15T03:30:00.000Z"), // LA 2026-01-14
            hToCOrgRatio: 0.3,
            oToCOrgRatio: 0.04,
            totalCarbonPercent: 80,
            organicCarbonPercent: 79,
          }),
          sample({
            id: "s2",
            sampleCode: "S-A-02",
            productionRunId: "run-a",
            samplingTime: new Date("2026-01-15T09:30:00.000Z"), // LA 2026-01-15
            hToCOrgRatio: 0.31,
            oToCOrgRatio: 0.05,
            totalCarbonPercent: 81,
            organicCarbonPercent: 80,
          }),
        ],
      }),
    ]);

    expect(summary.distinctRunDayCount).toBe(2);
  });

  it("resolves offset-bearing string timestamps through the facility branch (UTC-8)", () => {
    // A raw/string-backed samplingTime must classify on the same facility-local
    // day as a Date. Two run-a samples share the UTC day 2026-01-15 but fall on
    // different LA local days — string handling must not slice to the UTC day.
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        facilityTimezone: "America/Los_Angeles",
        endDate: "2026-01-31",
        samples: [
          sample({
            id: "s1",
            sampleCode: "S-A-01",
            productionRunId: "run-a",
            // LA 2026-01-14, not the UTC-sliced 2026-01-15.
            samplingTime: "2026-01-15T03:30:00.000Z" as unknown as Date,
            hToCOrgRatio: 0.3,
            oToCOrgRatio: 0.04,
            totalCarbonPercent: 80,
            organicCarbonPercent: 79,
          }),
          sample({
            id: "s2",
            sampleCode: "S-A-02",
            productionRunId: "run-a",
            samplingTime: "2026-01-15T09:30:00.000Z" as unknown as Date, // LA 2026-01-15
            hToCOrgRatio: 0.31,
            oToCOrgRatio: 0.05,
            totalCarbonPercent: 81,
            organicCarbonPercent: 80,
          }),
        ],
      }),
    ]);

    expect(summary.replicates[0].samplingDay).toBe("2026-01-14");
    expect(summary.distinctRunDayCount).toBe(2);
  });

  it("keeps a date-only string as its calendar day", () => {
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        facilityTimezone: "America/Los_Angeles",
        endDate: "2026-01-31",
        samples: [
          sample({
            id: "s1",
            sampleCode: "S-A-01",
            samplingTime: "2026-01-15" as unknown as Date,
            hToCOrgRatio: 0.3,
            oToCOrgRatio: 0.04,
            totalCarbonPercent: 80,
            organicCarbonPercent: 79,
          }),
        ],
      }),
    ]);

    expect(summary.replicates[0].samplingDay).toBe("2026-01-15");
  });
});

describe("summarizeFutureReplicates", () => {
  it("counts replicates dated after today and reports the earliest future day", () => {
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        samples: [
          ...eligibleSamples(),
          sample({
            id: "s-future",
            sampleCode: "S-A-99",
            samplingTime: new Date("2027-12-02T12:00:00.000Z"),
            hToCOrgRatio: 0.3,
            oToCOrgRatio: 0.04,
          }),
        ],
      }),
    ]);

    expect(summarizeFutureReplicates(summary, "2026-07-21")).toEqual({
      count: 1,
      earliestDay: "2027-12-02",
    });
  });

  it("returns zero with no earliest day when every replicate is past-dated", () => {
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        samples: eligibleSamples(),
      }),
    ]);

    expect(summarizeFutureReplicates(summary, "2026-07-21")).toEqual({
      count: 0,
      earliestDay: null,
    });
  });

  it("treats a replicate dated exactly today as not future", () => {
    const [summary] = buildDurabilityBatchSummaries([
      batch({
        creditBatchId: "cb-a",
        creditBatchCode: "CB-A",
        samples: [
          sample({
            id: "s-today",
            sampleCode: "S-A-01",
            samplingTime: new Date("2026-07-21T09:00:00.000Z"),
            hToCOrgRatio: 0.3,
            oToCOrgRatio: 0.04,
          }),
        ],
      }),
    ]);

    expect(summarizeFutureReplicates(summary, "2026-07-21").count).toBe(0);
  });
});

describe("buildDurabilityBatchSummaries future-sample facts", () => {
  const asOf = new Date("2026-07-21T12:00:00.000Z");
  const futureSample = () =>
    sample({
      id: "s-future",
      sampleCode: "S-A-99",
      samplingTime: new Date("2027-12-02T12:00:00.000Z"),
      hToCOrgRatio: 0.3,
      oToCOrgRatio: 0.04,
    });

  it("claims baseline countability for a future sample while still on Method A", () => {
    const [summary] = buildDurabilityBatchSummaries(
      [
        batch({
          creditBatchId: "cb-a",
          creditBatchCode: "CB-A",
          facilityTimezone: "UTC",
          samplingMethod: "method_a",
          methodBUnlockedAt: null,
          samples: [...eligibleSamples(), futureSample()],
        }),
      ],
      undefined,
      asOf,
    );

    expect(summary.future.count).toBe(1);
    expect(summary.future.earliestDay).toBe("2027-12-02");
    expect(summary.future.countsTowardBaseline).toBe(true);
  });

  it("drops the baseline claim once the process has unlocked Method B", () => {
    const [summary] = buildDurabilityBatchSummaries(
      [
        batch({
          creditBatchId: "cb-a",
          creditBatchCode: "CB-A",
          facilityTimezone: "UTC",
          samplingMethod: "method_b",
          methodBUnlockedAt: new Date("2026-02-01T00:00:00.000Z"),
          samples: [...eligibleSamples(), futureSample()],
        }),
      ],
      undefined,
      asOf,
    );

    expect(summary.future.count).toBe(1);
    expect(summary.future.countsTowardBaseline).toBe(false);
  });

  it("resolves the future cut against the facility-local day, not UTC", () => {
    // 2026-07-21T22:00Z is already 2026-07-22 in Kiritimati (UTC+14). A sample
    // at 2026-07-22T06:00Z is 2026-07-22T20:00 local — the SAME local day as
    // "today", so it is NOT future. A UTC comparison would wrongly flag it.
    const [summary] = buildDurabilityBatchSummaries(
      [
        batch({
          creditBatchId: "cb-a",
          creditBatchCode: "CB-A",
          facilityTimezone: "Pacific/Kiritimati",
          samplingMethod: "method_a",
          methodBUnlockedAt: null,
          samples: [
            sample({
              id: "s-sameday",
              sampleCode: "S-A-01",
              samplingTime: new Date("2026-07-22T06:00:00.000Z"),
              hToCOrgRatio: 0.3,
              oToCOrgRatio: 0.04,
            }),
          ],
        }),
      ],
      undefined,
      new Date("2026-07-21T22:00:00.000Z"),
    );

    expect(summary.future.count).toBe(0);
  });
});
