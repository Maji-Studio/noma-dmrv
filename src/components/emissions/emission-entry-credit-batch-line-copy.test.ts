import { describe, expect, it } from "vitest";
import { describeEmissionEntryCreditBatchLine } from "./emission-entry-credit-batch-line-copy";

describe("describeEmissionEntryCreditBatchLine", () => {
  it("names the batch the form was opened from, with its window", () => {
    const copy = describeEmissionEntryCreditBatchLine({
      creditBatchId: "b1",
      code: "CB-26-001",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(copy.lead).toBe("Credit batch: ");
    expect(copy.batches).toEqual([{ id: "b1", code: "CB-26-001", startDate: "2026-09-01", endDate: "2026-09-30" }]);
    expect(copy.info).toContain("Its date never moves it to another batch");
    expect(copy.infoLabel).toBe("Which credit batch this entry belongs to");
    expect(copy.busy).toBe(false);
    expect(copy.retry).toBe(false);
  });
});
