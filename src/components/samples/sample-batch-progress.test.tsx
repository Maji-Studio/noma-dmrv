import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  DurabilityBatchSummary,
  DurabilitySummaryReplicate,
} from "@/lib/certification/durability-batch-summary";

const hookState = vi.hoisted(() => ({
  summary: null as DurabilityBatchSummary | null,
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-certification", () => ({
  useBatchDurabilitySummary: () => ({
    data: hookState.summary,
    isLoading: false,
    error: null,
  }),
}));

const { SampleBatchProgress } = await import("./sample-batch-progress");

const MINIMUM_REPLICATES = 3;

function replicate(
  overrides: Partial<DurabilitySummaryReplicate> & { id: string },
): DurabilitySummaryReplicate {
  return {
    sampleCode: `SMP-${overrides.id}`,
    productionRunId: null,
    productionRunCode: null,
    samplingDay: "2026-07-01",
    labName: null,
    hToCorg: 0.4,
    oToCorg: 0.15,
    totalCarbonPercent: 80,
    organicCarbonPercent: 78,
    outlier: false,
    ...overrides,
  };
}

function summaryWith(
  replicates: DurabilitySummaryReplicate[],
): DurabilityBatchSummary {
  const usableReplicateCount = replicates.filter(
    (r) => r.hToCorg != null && r.oToCorg != null,
  ).length;
  const usableDays = new Set(
    replicates
      .filter((r) => r.hToCorg != null && r.oToCorg != null)
      .map((r) => `${r.productionRunId ?? "?"}::${r.samplingDay ?? "?"}`),
  );

  return {
    creditBatchId: "batch-1",
    creditBatchCode: "CB-001",
    sampling: "sampled",
    durabilityOption: "200_year",
    sampleCount: replicates.length,
    usableReplicateCount,
    minimumReplicates: MINIMUM_REPLICATES,
    meetsMinimum: usableReplicateCount >= MINIMUM_REPLICATES,
    distinctRunDayCount: usableDays.size,
    distributionWarning:
      usableReplicateCount >= MINIMUM_REPLICATES && usableDays.size <= 1,
    eligibility: {
      eligible: usableReplicateCount > 0 ? true : null,
      hToCorgMean: usableReplicateCount > 0 ? 0.4 : null,
      oToCorgMean: usableReplicateCount > 0 ? 0.15 : null,
      hToCWithinThreshold: usableReplicateCount > 0 ? true : null,
      oToCWithinThreshold: usableReplicateCount > 0 ? true : null,
    },
    submitted: {
      hToCorg: null,
      totalCarbonPercent: null,
      inorganicCarbonPercent: null,
      productMassKg: 1000,
    },
    replicates,
    future: { count: 0, earliestDay: null, countsTowardBaseline: true },
  };
}

function render(replicates: DurabilitySummaryReplicate[]): string {
  hookState.summary = summaryWith(replicates);
  return renderToStaticMarkup(<SampleBatchProgress creditBatchId="batch-1" />);
}

describe("SampleBatchProgress", () => {
  it("omits days that only unusable replicates span", () => {
    const html = render([
      replicate({ id: "1", samplingDay: "2026-07-01" }),
      replicate({ id: "2", samplingDay: "2026-07-02", oToCorg: null }),
      replicate({ id: "3", samplingDay: "2026-07-03", oToCorg: null }),
    ]);

    expect(html).toContain("2026-07-01");
    expect(html).not.toContain("2026-07-02");
    expect(html).not.toContain("2026-07-03");
  });

  it("names the missing chemistry instead of asking for more samples", () => {
    const html = render([
      replicate({ id: "1" }),
      replicate({ id: "2", oToCorg: null }),
      replicate({ id: "3", oToCorg: null }),
    ]);

    expect(html).toContain(
      "This batch has 1 usable replicate. 2 recorded samples don&#x27;t count yet — enter O:Corg on them to reach the ≥3 minimum.",
    );
  });

  it("asks for the remaining samples too when filling the blanks is not enough", () => {
    const html = render([replicate({ id: "1", hToCorg: null })]);

    expect(html).toContain(
      "This batch has 0 usable replicates. 1 recorded sample doesn&#x27;t count yet — enter H:Corg on it, then add 2 more (across distinct runs/days) to reach the ≥3 minimum.",
    );
  });

  it("keeps the plain shortfall hint when every recorded sample is complete", () => {
    const html = render([replicate({ id: "1" })]);

    expect(html).toContain(
      "This batch has 1 usable replicate — add 2 more (across distinct runs/days) to reach the ≥3 minimum.",
    );
  });

  it("reports the minimum as met once enough replicates are usable", () => {
    const html = render([
      replicate({ id: "1", samplingDay: "2026-07-01" }),
      replicate({ id: "2", samplingDay: "2026-07-02" }),
      replicate({ id: "3", samplingDay: "2026-07-03" }),
    ]);

    expect(html).toContain(
      "This batch already meets the ≥3-sample minimum across distinct runs/days.",
    );
  });
});
