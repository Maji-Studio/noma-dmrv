import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { CreditBatchOverview } from "./credit-batch-overview";

const creditBatch = {
  id: "batch-1",
  code: "CB-001",
  facilityId: "facility-1",
  feedstockTypeName: "Hardwood",
  appliedWeightTons: 1,
  productionRunCount: 2,
  durabilityOption: "200_year",
  siteManagementNotes: null,
} as CreditBatchWithRelations;

describe("CreditBatchOverview", () => {
  it("renders a retryable run-load error instead of a false empty state", () => {
    const html = renderToStaticMarkup(
      <CreditBatchOverview
        creditBatch={creditBatch}
        productionRuns={[]}
        isLoadingRuns={false}
        runsError={new Error("failed")}
        isRetryingRuns={false}
        onRetryRuns={vi.fn()}
      />,
    );

    expect(html).toContain("Production runs unavailable");
    expect(html).toContain("Retry");
    expect(html).not.toContain("No production runs linked");
  });
});
