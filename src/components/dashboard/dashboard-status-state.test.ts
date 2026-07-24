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
  it("uses error for blocking flags", () => {
    expect(deriveAttentionSummaryState({ total: 4, flagsTotal: 1 })).toBe(
      "error",
    );
  });

  it("uses warning when only pending items remain", () => {
    expect(deriveAttentionSummaryState({ total: 4, flagsTotal: 0 })).toBe(
      "warning",
    );
  });

  it("uses success when no items are open", () => {
    expect(deriveAttentionSummaryState({ total: 0, flagsTotal: 0 })).toBe(
      "success",
    );
  });
});
