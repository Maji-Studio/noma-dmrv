import { describe, expect, it } from "vitest";
import { getFeedstockTypeDeleteDecision } from "./feedstock-type-deletion";

describe("getFeedstockTypeDeleteDecision", () => {
  it("allows a hard delete when the type is unused", () => {
    expect(getFeedstockTypeDeleteDecision([])).toEqual({ action: "delete" });
  });

  it("returns the blocking reference so the caller can offer archive", () => {
    const conflict = { entity: "feedstock", id: "feedstock-1", code: "FS-1" };
    expect(getFeedstockTypeDeleteDecision([conflict])).toEqual({
      action: "conflict",
      conflict,
    });
  });
});
