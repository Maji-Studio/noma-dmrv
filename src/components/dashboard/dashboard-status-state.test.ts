import { describe, expect, it } from "vitest";
import {
  deriveAttentionSummaryState,
  deriveWorstDashboardState,
} from "./dashboard-status-state";

describe("deriveWorstDashboardState", () => {
  it("orders dashboard signals by operator urgency", () => {
    expect(
      deriveWorstDashboardState(["in-progress", "warning", "error"]),
    ).toBe("error");
    expect(deriveWorstDashboardState(["in-progress", "warning"])).toBe(
      "warning",
    );
    expect(deriveWorstDashboardState(["in-progress"])).toBe("in-progress");
    expect(deriveWorstDashboardState([])).toBe("success");
  });
});

describe("deriveAttentionSummaryState", () => {
  it("uses warning when attention items are open", () => {
    expect(deriveAttentionSummaryState(4)).toBe("warning");
  });

  it("uses success when no items are open", () => {
    expect(deriveAttentionSummaryState(0)).toBe("success");
  });
});
