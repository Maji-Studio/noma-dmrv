import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { CreditBatchTimeline } from "./credit-batch-timeline";

vi.mock("@/hooks/use-certification", () => ({
  useCreditBatchHealthSummaries: () => ({ data: { batch: {
    state: "incomplete", issueCount: 2, checkCount: 1, linesToDecide: 0,
    removalId: "interrupted", removalCode: "RM-26-001", removalStatus: null, removalInterrupted: true, hasSubmittedRemoval: false,
    productionEmissionsClaimedByRemovalCode: null, ghgStatementId: null, ghgStatementStatus: null,
  } } }),
}));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatchTimelineFacts: () => ({ data: {} }),
}));

it("keeps the interrupted bar's open to-do badge and accessible count", () => {
  const html = renderToStaticMarkup(<CreditBatchTimeline
    facilityId="facility"
    today="2026-08-15"
    onNewBatch={vi.fn()}
    batches={[{
      id: "batch", code: "CB-26-009", facilityId: "facility", name: null,
      feedstockTypeId: "feedstock", feedstockTypeName: "Pine",
      startDate: "2026-08-01", endDate: "2026-08-31",
    } as CreditBatchWithRelations]}
  />);
  expect(html).toContain("Submission interrupted, 3 open to-dos");
  expect(html).toContain('aria-label="3 open to-dos"');
  expect(html).toContain(">3</span>");
});
