import { describe, expect, it } from "vitest";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@/db/schema/common";
import {
  activityFilterOptionLabel,
  activityKindOptions,
  activityKindTotals,
  activityRecordTypeOptions,
  hasActivityFilters,
  parseActivityFilter,
} from "./activity-filter-options";

const counts = [
  { entityType: "production_run", action: "updated", count: 2 },
  { entityType: "credit_batch", action: "updated", count: 1 },
  { entityType: "credit_batch", action: "created", count: 1 },
  { entityType: "lab_sample", action: "deleted", count: 1 },
] as const;
const summaryCounts = counts.map((row) => ({ ...row }));

describe("activity filter options", () => {
  it("totals kinds across record types in reading order, leaving out empty kinds", () => {
    expect(activityKindTotals(summaryCounts)).toEqual([
      { value: "created", label: "Created", count: 1 },
      { value: "updated", label: "Updated", count: 3 },
      { value: "deleted", label: "Deleted", count: 1 },
    ]);
  });

  it("offers record types with activity in custody order", () => {
    expect(activityRecordTypeOptions(summaryCounts).map((option) => [option.value, option.count])).toEqual([
      ["credit_batch", 2], ["production_run", 2], ["lab_sample", 1],
    ]);
  });

  it("keeps a selected choice listed when it has no changes", () => {
    expect(activityRecordTypeOptions(summaryCounts, "order").map((option) => option.value)).toContain("order");
    expect(activityKindOptions(summaryCounts, "status_changed").map((option) => option.value))
      .toEqual(["created", "updated", "status_changed", "deleted"]);
    expect(activityKindOptions([], "deleted")).toEqual([{ value: "deleted", label: "Deleted", count: 0 }]);
  });

  it("maps select values back to server filters", () => {
    expect(parseActivityFilter("deleted", ACTIVITY_ACTIONS)).toBe("deleted");
    expect(parseActivityFilter("", ACTIVITY_ACTIONS)).toBeUndefined();
    expect(parseActivityFilter("archived", ACTIVITY_ACTIONS)).toBeUndefined();
    expect(parseActivityFilter("lab_sample", ACTIVITY_ENTITY_TYPES)).toBe("lab_sample");
    expect(hasActivityFilters({})).toBe(false);
    expect(hasActivityFilters({ entityType: "order" })).toBe(true);
  });

  it("shows the count beside each option", () => {
    expect(activityFilterOptionLabel({ value: "updated", label: "Updated", count: 1200 })).toBe("Updated (1,200)");
  });
});
