import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MemberCreditBatch } from "@/fn/certification/certify-context";
import { SubmissionOverview } from "./submission-overview";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

const BATCH = {
  id: "batch-1",
  code: "CB-26-001",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  appliedWeightTons: 10,
  appliedDryWeightTons: 8.5,
  durabilityOption: "1000_year",
  sampling: "sampled",
  productionRunCount: 2,
  applicationCount: 3,
  co2eStoredPreview: {
    co2eStoredTonnes: 3,
  },
} as MemberCreditBatch;

describe("SubmissionOverview", () => {
  it("summarises the submission and links each detailed batch card in a new tab", () => {
    const html = renderToStaticMarkup(
      <SubmissionOverview
        memberBatches={[BATCH]}
        facilityId="facility-1"
      />,
    );

    expect(html).toContain("Submission overview");
    expect(html).toContain("1 credit batch");
    expect(html).toContain("8.5 t");
    expect(html).toContain("3.0 t CO₂e");
    expect(html).toContain("Submitted biochar (dry)");
    expect(html).toContain("CB-26-001");
    expect(html).toContain("Jul 1 – Jul 31, 2026");
    expect(html).toContain("1000-Year (R₀ Reflectance)");
    expect(html).toContain("Sampled");
    expect(html).toContain("2 production runs");
    expect(html).toContain("3 applications");
    expect(html).toContain(
      'href="/credit-batches?facility=facility-1&amp;batch=batch-1"',
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
