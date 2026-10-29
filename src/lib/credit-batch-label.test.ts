import { describe, expect, it } from "vitest";
import { creditBatchLabel } from "./credit-batch-label";

describe("creditBatchLabel", () => {
  it("shows the name when the batch has one", () => {
    expect(creditBatchLabel({ code: "CB-26-043", name: "September maize" })).toBe("September maize");
  });

  it("falls back to the code when the name is null, missing or blank", () => {
    expect(creditBatchLabel({ code: "CB-26-043", name: null })).toBe("CB-26-043");
    expect(creditBatchLabel({ code: "CB-26-043" })).toBe("CB-26-043");
    expect(creditBatchLabel({ code: "CB-26-043", name: "   " })).toBe("CB-26-043");
  });
});
