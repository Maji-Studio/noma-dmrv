import { describe, expect, it } from "vitest";
import {
  assertProductionRunOutcome,
  assertProductionRunTransition,
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
    expect(() =>
      assertProductionRunOutcome({
        status: "failed",
        startTime: new Date("2026-01-01T10:00:00Z"),
        endTime: new Date("2026-01-01T11:00:00Z"),
        consumedFeedstockKg: 100,
        biocharOutputKg: null,
        cancellationReason: null,
      }),
    ).not.toThrow();
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
