import { expect, it } from "vitest";
import { getCreditBatchProductionSpanIssue } from "./credit-batch-production-span";

const span = { creditBatchCode: "CB-1", latestEndingRunCode: "RUN-31", startedAt: "2026-01-01T08:00:00Z" };
it("names the run that ends beyond an otherwise valid January window", () => {
  expect(getCreditBatchProductionSpanIssue({ ...span, endedAt: "2026-02-01T08:00:00Z" }))
    .toBe("Production run RUN-31 ends on or after Feb 1, 2026, 08:00 UTC, so credit batch CB-1 would cover one month or more. Move the run to another credit batch.");
});
it("accepts a span just below the boundary", () => {
  expect(getCreditBatchProductionSpanIssue({ ...span, endedAt: "2026-02-01T07:59:59.999Z" })).toBeNull();
});
