import { describe, expect, it } from "vitest";
import { describeSampleCreditBatchLine } from "./sample-credit-batch-line-copy";

describe("describeSampleCreditBatchLine", () => {
  it("names the selected batch and explains the Sample characterises it", () => {
    const copy = describeSampleCreditBatchLine({ state: "selected", batch: { id: "b1", code: "CB-26-009" } });
    expect(copy.lead).toBe("Credit batch: ");
    expect(copy.batches).toEqual([{ id: "b1", code: "CB-26-009" }]);
    expect(copy.info).toContain("characterises the credit batch chosen above");
    expect(copy.infoLabel).toBeTruthy();
  });

  it("says Not set, naming what is needed, when nothing is selected", () => {
    const copy = describeSampleCreditBatchLine({ state: "empty" });
    expect(copy.lead).toBe("Credit batch: Not set");
    expect(copy.batches).toEqual([]);
    expect(copy.info).toContain("Choose a credit batch");
  });

  it("says Not available, without Retry, when the batch is gone", () => {
    const copy = describeSampleCreditBatchLine({ state: "unavailable" });
    expect(copy.lead).toBe("Credit batch: Not available");
    expect(copy.retry).toBe(false);
    expect(copy.info).toContain("could not be found");
  });

  it("covers pending and failed lookups", () => {
    expect(describeSampleCreditBatchLine({ state: "pending" }).busy).toBe(true);
    expect(describeSampleCreditBatchLine({ state: "error" }).retry).toBe(true);
  });

  it("uses no en or em dashes", () => {
    for (const state of ["empty", "pending", "error", "unavailable"] as const) {
      const c = describeSampleCreditBatchLine({ state });
      expect(`${c.lead}${c.info ?? ""}`).not.toMatch(/[–—]/);
    }
  });
});
