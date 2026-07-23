import { describe, expect, it } from "vitest";
import { CREDIT_BATCH_DELETE_MESSAGE } from "./credit-batch-list";

describe("credit batch delete confirmation", () => {
  it("describes the current grouping, run, and sample consequences", () => {
    expect(CREDIT_BATCH_DELETE_MESSAGE).toContain("removes the grouping");
    expect(CREDIT_BATCH_DELETE_MESSAGE).toContain(
      "releases its production runs",
    );
    expect(CREDIT_BATCH_DELETE_MESSAGE).toContain(
      "clears direct membership from its lab samples",
    );
    expect(CREDIT_BATCH_DELETE_MESSAGE).not.toMatch(
      /applications|re-link|manually/i,
    );
  });
});
