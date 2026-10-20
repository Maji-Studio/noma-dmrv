import { expect, it } from "vitest";
import { getCreditBatchProductionSpanIssue } from "./credit-batch-production-span";

const span = { creditBatchCode: "CB-1", latestEndingRunCode: "RUN-31", startedAt: "2026-01-01T08:00:00Z" };
it("names the run that ends beyond an otherwise valid January window", () => {
  expect(getCreditBatchProductionSpanIssue({ ...span, endedAt: "2026-02-01T08:00:00Z" }))
    .toBe("Production run RUN-31 ends on or after Feb 1, 2026, 08:00 UTC, so credit batch CB-1 would cover one month or more. Discard or delete every Removal that holds applied mass from credit batch CB-1, including this one. Until then, the Start date and End date of credit batch CB-1 stay locked. Then shorten those dates so the production runs in credit batch CB-1 span less than one month. Then create a new Removal.");
});
it("accepts a span just below the boundary", () => {
  expect(getCreditBatchProductionSpanIssue({ ...span, endedAt: "2026-02-01T07:59:59.999Z" })).toBeNull();
});
it("names the undeletable holder and directs the operator to Isometric", () => {
  expect(getCreditBatchProductionSpanIssue({
    ...span, endedAt: "2026-02-01T08:00:00Z", undeletableRemovalCodes: ["REM-1"],
  })).toBe("Production run RUN-31 ends on or after Feb 1, 2026, 08:00 UTC, so credit batch CB-1 would cover one month or more. Removal REM-1 was sent to Isometric and cannot be deleted, so the Start date and End date of credit batch CB-1 stay locked. Contact Isometric about Removal REM-1.");
});
it("names every undeletable holder", () => {
  expect(getCreditBatchProductionSpanIssue({
    ...span, endedAt: "2026-02-01T08:00:00Z", undeletableRemovalCodes: ["REM-1", "REM-2"],
  })).toBe("Production run RUN-31 ends on or after Feb 1, 2026, 08:00 UTC, so credit batch CB-1 would cover one month or more. Removal REM-1 and Removal REM-2 were sent to Isometric and cannot be deleted, so the Start date and End date of credit batch CB-1 stay locked. Contact Isometric about Removal REM-1 and Removal REM-2.");
});
