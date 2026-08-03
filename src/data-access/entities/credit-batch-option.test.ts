import { describe, expect, it } from "vitest";
import { toCreditBatchEntityOption } from "./credit-batch-option";

describe("toCreditBatchEntityOption", () => {
  it("uses the production date range and status without a visible batch code", () => {
    expect(
      toCreditBatchEntityOption({
        id: "batch-1",
        code: "CB-26-001",
        status: "pending",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      }),
    ).toEqual({
      id: "batch-1",
      code: "CB-26-001",
      name: "Jul 1 to Jul 31, 2026",
      subtitle: "Pending",
    });
  });
});
