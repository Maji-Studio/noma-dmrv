import { describe, expect, it } from "vitest";
import { toCreditBatchEntityOption } from "./credit-batch-option";

describe("toCreditBatchEntityOption", () => {
  it("names the batch by code before its production window, with its status", () => {
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
      name: "CB-26-001 · Jul 1 to Jul 31, 2026",
      subtitle: "Pending",
    });
  });
});
