import { describe, expect, it } from "vitest";
import {
  ENTITY_STATUS_STATES,
  STATUS_STATE_BADGE_CLASSES,
  STATUS_STATE_CLASSES,
  STATUS_STATE_COLOR_TOKENS,
  getStatusState,
  getStatusStateColor,
} from "./status-state";

describe("semantic entity status states", () => {
  it("uses only the canonical five classes", () => {
    expect(new Set(STATUS_STATE_CLASSES)).toEqual(
      new Set(["neutral", "in-progress", "success", "warning", "error"]),
    );
    expect(new Set(Object.values(ENTITY_STATUS_STATES))).toEqual(
      new Set(STATUS_STATE_CLASSES),
    );
    expect(Object.keys(STATUS_STATE_BADGE_CLASSES)).toEqual(
      expect.arrayContaining([...STATUS_STATE_CLASSES]),
    );
    expect(Object.keys(STATUS_STATE_COLOR_TOKENS)).toEqual(
      expect.arrayContaining([...STATUS_STATE_CLASSES]),
    );
  });

  it("distinguishes failed from cancelled", () => {
    expect(getStatusState("failed")).toBe("error");
    expect(getStatusStateColor("failed")).toBe("var(--st-bad)");
    expect(getStatusState("cancelled")).toBe("neutral");
    expect(getStatusStateColor("cancelled")).toBe("var(--st-off)");
  });

  it("keeps the shared mapping exhaustive for known semantic statuses", () => {
    expect(ENTITY_STATUS_STATES).toEqual({
      draft: "neutral",
      superseded: "neutral",
      cancelled: "neutral",
      missing_data: "neutral",
      no_deliveries: "neutral",
      method_a: "neutral",
      running: "in-progress",
      sold: "in-progress",
      ordered: "in-progress",
      partial: "in-progress",
      submitted: "in-progress",
      method_b: "in-progress",
      complete: "success",
      delivered: "success",
      applied: "success",
      verified: "success",
      issued: "success",
      ready: "success",
      processed: "success",
      fulfilled: "success",
      uploaded: "success",
      succeeded: "success",
      accepted: "success",
      eligible: "success",
      pending: "warning",
      upcoming: "warning",
      testing: "warning",
      scheduled: "warning",
      conditional: "warning",
      void: "error",
      failed: "error",
      rejected: "error",
      ineligible: "error",
    });
  });

  it("falls back unknown statuses to neutral", () => {
    expect(getStatusState("future_status")).toBe("neutral");
  });
});
