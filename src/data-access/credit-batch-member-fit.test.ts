import { describe, expect, it } from "vitest";
import { creditBatchMemberConflict } from "./credit-batch-member-fit";

const batch = { facilityId: "facility", feedstockTypeId: "wood", startDate: "2025-10-01", endDate: "2025-10-31" };
const run = { facilityId: "facility", feedstockTypeId: "wood", day: "2025-10-02" };

describe("creditBatchMemberConflict", () => {
  it.each(["2025-10-01", "2025-10-02", "2025-10-31"])("includes %s in the window", day => {
    expect(creditBatchMemberConflict(batch, { ...run, day })).toBeNull();
  });

  it.each(["2025-09-30", "2025-11-01"])("refuses %s outside the window", day => {
    expect(creditBatchMemberConflict(batch, { ...run, day })).toBe("outside-window");
  });

  it("checks facility before feedstock and window", () => {
    expect(creditBatchMemberConflict(batch, { facilityId: "elsewhere", feedstockTypeId: null, day: "2025-11-01" })).toBe("facility");
  });

  it.each(["straw", null])("refuses a different or non-single feedstock set (%s) before window", feedstockTypeId => {
    expect(creditBatchMemberConflict(batch, { ...run, feedstockTypeId, day: "2025-11-01" })).toBe("feedstock");
  });
});
