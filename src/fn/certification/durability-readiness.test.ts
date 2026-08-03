import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import {
  buildDurabilityBatchGates,
  buildDurabilityGates,
} from "./durability-readiness";

function sample(
  sampleCode: string,
  samplingTime: string,
  productionRunId: string,
): Sample {
  return {
    sampleCode,
    samplingTime: new Date(samplingTime),
    productionRunId,
    hToCOrgRatio: 0.3,
    oToCOrgRatio: 0.1,
  } as Sample;
}

function batch(
  facilityTimezone: string,
  samples: Sample[],
): CreditBatchWithSamples {
  return {
    creditBatchId: "batch-1",
    creditBatchCode: "CB-1",
    startDate: "2026-01-15",
    endDate: "2026-01-31",
    facilityTimezone,
    samples,
    runs: [],
    sampling: "sampled",
    declaredHToCorgRatio: null,
    durabilityOption: "200_year",
  };
}

describe("buildDurabilityGates facility-local sampling day", () => {
  it("accepts samples on the local start day when the UTC day is earlier", () => {
    const result = buildDurabilityGates([
      batch("Africa/Nairobi", [
        sample("SAM-1", "2026-01-14T21:30:00.000Z", "run-1"),
        sample("SAM-2", "2026-01-14T22:30:00.000Z", "run-2"),
        sample("SAM-3", "2026-01-14T23:30:00.000Z", "run-3"),
      ]),
    ]);

    expect(result.blockers).toEqual([]);
  });

  it("rejects a sample locally before the start day when the UTC day matches", () => {
    const result = buildDurabilityGates([
      batch("America/Los_Angeles", [
        sample("SAM-1", "2026-01-15T07:30:00.000Z", "run-1"),
        sample("SAM-2", "2026-01-15T08:30:00.000Z", "run-2"),
        sample("SAM-3", "2026-01-15T09:30:00.000Z", "run-3"),
      ]),
    ]);

    expect(result.blockers).toContain(
      "Sample SAM-1 was taken on 2026-01-14, before credit batch CB-1's production window, 2026-01-15 to 2026-01-31. Correct the Sample date before submitting (§8.3.1).",
    );
  });
});

describe("load-ready gate attribution", () => {
  it("keeps each batch's blockers attributable to that batch", () => {
    const first = batch("UTC", []);
    const second = {
      ...batch("UTC", []),
      creditBatchId: "batch-2",
      creditBatchCode: "CB-2",
      sampling: "unsampled" as const,
    };

    const result = buildDurabilityBatchGates([first, second]);

    expect(result.blockersByBatchId).toEqual({
      "batch-1": [
          "Credit batch CB-1 is marked as sampled but has no Samples. Add at least 3 Samples before submitting.",
      ],
      "batch-2": [],
    });
    expect(result.blockers).toEqual(result.blockersByBatchId["batch-1"]);
  });
});
