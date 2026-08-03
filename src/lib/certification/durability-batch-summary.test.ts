import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import {
  buildDurabilityBatchSummaries,
  summarizeFutureSamples,
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
    sampling: "sampled",
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

  // §8.3.1 requires 3 samples representative of the batch's full range of
  // physical characteristics — NOT samples drawn from distinct runs or days. So
  // three replicates sharing one run/day is a fully ready batch.
  it("treats ≥3 replicates on a single run/day as ready", () => {
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
    expect(summary.eligibility.eligible).toBe(true);
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

  it("counts only USABLE (paired-chemistry) replicates toward the ≥3 minimum", () => {
    // 3 complete replicates + 1 carrying H/C only. The incomplete one is shown
    // as a sample row but must not count toward the §8.3.1 ≥3 minimum.
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
    expect(summary.meetsMinimum).toBe(true);
  });

  it("handles string sampling timestamps when resolving replicate days", () => {
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

    expect(summary.replicates.map((r) => r.samplingDay)).toEqual([
      "2026-01-12",
      "2026-01-13",
      "2026-01-14",
    ]);
  });
});

// The readiness surface must classify a sampling instant on the facility-LOCAL
// calendar day, matching the write guard (`assertSampleNotBeforeBatchWindow`)
// and the submission gate (`isoSamplingDay`) — otherwise the sampling days shown
// here diverge from the production-window checks submission applies (issue
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

  it("resolves replicate days in facility-local days (UTC-8)", () => {
    // Two run-a samples share the UTC day 2026-01-15 but fall on different LA
    // local days — the local classification separates them, where a UTC reading
    // would collapse them onto one day.
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

    expect(summary.replicates.map((r) => r.samplingDay)).toEqual([
      "2026-01-14",
      "2026-01-15",
    ]);
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

    expect(summary.replicates.map((r) => r.samplingDay)).toEqual([
      "2026-01-14",
      "2026-01-15",
    ]);
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

describe("summarizeFutureSamples", () => {
  const asOf = new Date("2026-07-21T12:00:00.000Z");

  it("counts samples at or after the instant and reports the earliest facility-local day", () => {
    const result = summarizeFutureSamples(
      [
        { samplingTime: new Date("2026-01-14T00:00:00.000Z") },
        { samplingTime: new Date("2027-12-02T12:00:00.000Z") },
      ],
      asOf,
      "UTC",
    );

    expect(result).toEqual({ count: 1, earliestDay: "2027-12-02" });
  });

  it("returns zero with no earliest day when every sample is strictly past", () => {
    const result = summarizeFutureSamples(
      [{ samplingTime: new Date("2026-07-21T09:00:00.000Z") }],
      asOf,
      "UTC",
    );

    expect(result).toEqual({ count: 0, earliestDay: null });
  });

  it("flags a sample later the same calendar day (exact-instant, not day-only)", () => {
    // 18:00Z is after the 12:00Z cut yet the SAME UTC day — a day-only compare
    // would miss it, diverging from the server counter's exact-instant exclusion.
    const result = summarizeFutureSamples(
      [{ samplingTime: new Date("2026-07-21T18:00:00.000Z") }],
      asOf,
      "UTC",
    );

    expect(result).toEqual({ count: 1, earliestDay: "2026-07-21" });
  });

  it("treats a sample exactly at the instant as future (>=, matching the counter)", () => {
    const result = summarizeFutureSamples(
      [{ samplingTime: new Date("2026-07-21T12:00:00.000Z") }],
      asOf,
      "UTC",
    );

    expect(result.count).toBe(1);
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
          sampling: "sampled",
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

  it("does not claim that samples on an unsampled batch join the baseline", () => {
    const [summary] = buildDurabilityBatchSummaries(
      [
        batch({
          creditBatchId: "cb-a",
          creditBatchCode: "CB-A",
          facilityTimezone: "UTC",
          sampling: "unsampled",
          samples: [...eligibleSamples(), futureSample()],
        }),
      ],
      undefined,
      asOf,
    );

    expect(summary.future.count).toBe(1);
    expect(summary.future.countsTowardBaseline).toBe(false);
  });

  it("classifies on the exact instant but displays the facility-local day", () => {
    // Sample at 2027-01-01T20:00Z is after `asOf`, so it is future by instant.
    // In Kiritimati (UTC+14) that instant is 2027-01-02T10:00 local, so the
    // DISPLAYED day is 2027-01-02 — the facility-local day, not the UTC day.
    const [summary] = buildDurabilityBatchSummaries(
      [
        batch({
          creditBatchId: "cb-a",
          creditBatchCode: "CB-A",
          facilityTimezone: "Pacific/Kiritimati",
          sampling: "sampled",
          samples: [
            sample({
              id: "s-tz",
              sampleCode: "S-A-01",
              samplingTime: new Date("2027-01-01T20:00:00.000Z"),
              hToCOrgRatio: 0.3,
              oToCOrgRatio: 0.04,
            }),
          ],
        }),
      ],
      undefined,
      asOf,
    );

    expect(summary.future.count).toBe(1);
    expect(summary.future.earliestDay).toBe("2027-01-02");
  });
});
