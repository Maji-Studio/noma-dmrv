import { describe, expect, it } from "vitest";
import {
  assertProductionRunOutcome,
  assertProductionRunTransition,
  shouldClearProductionRunEndTime,
  shouldIncludeProductionRunEndTime,
} from "./lifecycle";

describe("production-run lifecycle", () => {
  it.each([
    ["draft", "running"],
    ["draft", "cancelled"],
    ["running", "complete"],
    ["running", "failed"],
    ["complete", "running"],
    ["failed", "running"],
    ["cancelled", "cancelled"],
  ] as const)("allows %s → %s", (from, to) => {
    expect(() => assertProductionRunTransition(from, to)).not.toThrow();
  });

  it.each([
    ["draft", "complete"],
    ["draft", "failed"],
    ["complete", "cancelled"],
    ["failed", "complete"],
    ["cancelled", "running"],
  ] as const)("rejects %s → %s", (from, to) => {
    expect(() => assertProductionRunTransition(from, to)).toThrow();
  });

  it.each(["complete", "failed"] as const)(
    "includes the displayed end time for running → %s when end fields are not dirty",
    (to) => {
      expect(
        shouldIncludeProductionRunEndTime({
          endFieldsTouched: false,
          from: "running",
          to,
        }),
      ).toBe(true);
    },
  );

  it.each(["complete", "failed"] as const)(
    "clears the saved end time when reopening a %s run",
    (from) => {
      expect(
        shouldClearProductionRunEndTime({
          from,
          to: "running",
          existingEndTime: new Date("2026-01-01T11:00:00Z"),
        }),
      ).toBe(true);
    },
  );

  it("does not clear an end time for a non-reopening update", () => {
    expect(
      shouldClearProductionRunEndTime({
        from: "complete",
        to: "complete",
        existingEndTime: new Date("2026-01-01T11:00:00Z"),
      }),
    ).toBe(false);
  });

  it.each(["complete", "failed"] as const)(
    "does not rewrite the end time when an existing %s run remains terminal",
    (status) => {
      expect(
        shouldIncludeProductionRunEndTime({
          endFieldsTouched: false,
          from: status,
          to: status,
        }),
      ).toBe(false);
    },
  );

  it("does not treat cancelled as an end-required outcome", () => {
    expect(
      shouldIncludeProductionRunEndTime({
        endFieldsTouched: false,
        from: "running",
        to: "cancelled",
      }),
    ).toBe(false);
  });

  it("continues to include touched end fields regardless of status", () => {
    expect(
      shouldIncludeProductionRunEndTime({
        endFieldsTouched: true,
        from: "running",
        to: "cancelled",
      }),
    ).toBe(true);
  });

  it("requires physical facts for a complete run", () => {
    const base = {
      status: "complete" as const,
      startTime: new Date("2026-01-01T10:00:00Z"),
      endTime: new Date("2026-01-01T11:00:00Z"),
      consumedFeedstockKg: 100,
      biocharOutputKg: 20,
      cancellationReason: null,
    };

    expect(() => assertProductionRunOutcome(base)).not.toThrow();
    expect(() => assertProductionRunOutcome({ ...base, consumedFeedstockKg: 0 })).toThrow(
      "must consume feedstock",
    );
    expect(() => assertProductionRunOutcome({ ...base, biocharOutputKg: 0 })).toThrow(
      "positive biochar output",
    );
    expect(() => assertProductionRunOutcome({ ...base, endTime: null })).toThrow(
      "needs an end time",
    );
  });

  it("permits failed output to be absent but still requires consumption and an end", () => {
    const failed = {
        status: "failed",
        startTime: new Date("2026-01-01T10:00:00Z"),
        endTime: new Date("2026-01-01T11:00:00Z"),
        consumedFeedstockKg: 100,
        biocharOutputKg: null,
        cancellationReason: null,
      } as const;
    expect(() => assertProductionRunOutcome(failed)).not.toThrow();
    expect(() =>
      assertProductionRunOutcome({ ...failed, consumedFeedstockKg: 0 }),
    ).toThrow("must consume feedstock");
    expect(() =>
      assertProductionRunOutcome({ ...failed, endTime: null }),
    ).toThrow("needs an end time");
  });

  it("requires a running run to remain open-ended", () => {
    expect(() => assertProductionRunOutcome({
      status: "running",
      startTime: new Date("2026-01-01T10:00:00Z"),
      endTime: new Date("2026-01-01T11:00:00Z"),
      consumedFeedstockKg: 100,
      biocharOutputKg: 20,
      cancellationReason: null,
    })).toThrow("cannot have an end time");
  });

  it("requires a nonblank cancellation reason", () => {
    const cancelled = {
      status: "cancelled" as const,
      startTime: new Date("2026-01-01T10:00:00Z"),
      endTime: null,
      consumedFeedstockKg: 0,
      biocharOutputKg: null,
      cancellationReason: "operator error",
    };

    expect(() => assertProductionRunOutcome(cancelled)).not.toThrow();
    expect(() =>
      assertProductionRunOutcome({ ...cancelled, cancellationReason: "  " }),
    ).toThrow("cancellation reason");
  });
});
