import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildDurabilityBatchSummaries } from "@/lib/certification/durability-batch-summary";
import { CreditBatchDurabilityPanel } from "./credit-batch-durability-panel";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const [summary] = buildDurabilityBatchSummaries([{
  creditBatchId: "batch",
  creditBatchCode: "CB-1",
  sampling: "sampled",
  runs: [],
  samples: [],
}]);
const replicate = (id: string, sampleCode: string) => ({
  id, sampleCode, outlier: false, productionRunId: null, productionRunCode: null, samplingDay: null,
  labName: null, hToCorg: null, oToCorg: null, totalCarbonPercent: null, organicCarbonPercent: null,
});

vi.mock("@/hooks/use-certification", () => ({
  useBatchDurabilitySummary: () => ({
    data: { ...summary, sampleCount: 2, replicates: [replicate("s-1", "SAM-1"), replicate("s-2", "SAM-2")] },
    isLoading: false,
    error: null,
  }),
}));

describe("CreditBatchDurabilityPanel focus", () => {
  it("highlights only the Sample a deep link points at", () => {
    const html = renderToStaticMarkup(<CreditBatchDurabilityPanel creditBatchId="batch" facilityId="facility" focusedSampleId="s-2" />);
    expect(html).toContain('id="sample-row-s-2" data-focused="true"');
    expect(html).not.toContain('id="sample-row-s-1" data-focused');
  });

  it("highlights nothing without a focus", () => {
    const html = renderToStaticMarkup(<CreditBatchDurabilityPanel creditBatchId="batch" facilityId="facility" />);
    expect(html).not.toContain("data-focused");
  });
});
