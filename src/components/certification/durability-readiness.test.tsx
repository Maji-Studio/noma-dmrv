import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DurabilityBatchSummary } from "@/lib/certification/durability-batch-summary";

vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  CheckCircleIcon: () => <span data-icon="check" />,
  XCircleIcon: () => <span data-icon="error" />,
}));

import { DurabilityReadinessSignals } from "./durability-readiness";

function summary(): DurabilityBatchSummary {
  return {
    creditBatchId: "batch-1",
    creditBatchCode: "CB-1",
    sampling: "sampled",
    durabilityOption: "1000_year",
    sampleCount: 1,
    usableReplicateCount: 1,
    minimumReplicates: 3,
    meetsMinimum: false,
    eligibility: {
      eligible: true,
      hToCorgMean: 0.4,
      oToCorgMean: 0.1,
      hToCWithinThreshold: true,
      oToCWithinThreshold: true,
    },
    submitted: {
      hToCorg: null,
      totalCarbonPercent: null,
      inorganicCarbonPercent: null,
      productMassKg: 0,
    },
    replicates: [],
    future: {
      count: 1,
      earliestDay: "2027-01-21",
      countsTowardBaseline: true,
    },
  };
}

describe("DurabilityReadinessSignals", () => {
  it("puts completed checks first and adds no icon to incomplete signals", () => {
    const html = renderToStaticMarkup(
      <DurabilityReadinessSignals summary={summary()} />,
    );

    expect(html.indexOf("Chemistry eligible")).toBeLessThan(
      html.indexOf("1 of 3 usable Samples"),
    );
    expect(html.match(/data-icon="check"/g)).toHaveLength(1);
    expect(html).not.toContain('data-icon="error"');
    expect(html).not.toContain("future-dated");
    expect(html).not.toContain("Method-B baseline");
  });
});
