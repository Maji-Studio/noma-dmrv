import { describe, expect, it } from "vitest";
import { productionRunDateBounds } from "./date-filter-bounds";

describe("production run date prefilter bounds", () => {
  it("widens both inclusive local days to cover time zones across UTC midnight", () => {
    expect(productionRunDateBounds("2025-10-01", "2025-10-31")).toEqual({
      start: new Date("2025-09-30T00:00:00Z"),
      endExclusive: new Date("2025-11-02T00:00:00Z"),
    });
  });
});
