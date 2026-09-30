import { describe, expect, it } from "vitest";
import { getStatusState } from "@/lib/status-state";
import { toBadgeProps } from "./chain-status-badge";

describe("toBadgeProps", () => {
  it("passes known statuses through so the shared mapping picks the colour", () => {
    expect(toBadgeProps("missing_data")).toEqual({ status: "missing_data" });
    expect(getStatusState(toBadgeProps("missing_data").status)).toBe("neutral");
    expect(toBadgeProps("complete")).toEqual({ status: "complete" });
  });

  it("falls back to a neutral badge with a readable label", () => {
    expect(toBadgeProps("in_transit")).toEqual({
      status: "draft",
      label: "In transit",
    });
  });
});
