import { describe, expect, it } from "vitest";
import { assertProductionRunTimesNotFuture } from "./future-time";

const NOW = new Date("2026-07-15T12:00:00.000Z");

describe("production-run mutation future-time preflight", () => {
  it("accepts start and end exactly at the server clock boundary", () => {
    expect(() =>
      assertProductionRunTimesNotFuture(
        { startTime: NOW, endTime: NOW },
        NOW,
      ),
    ).not.toThrow();
  });

  it("identifies a future start field", () => {
    expect(() =>
      assertProductionRunTimesNotFuture(
        {
          startTime: new Date("2026-07-15T12:00:00.001Z"),
          endTime: null,
        },
        NOW,
      ),
    ).toThrow(
      "Start time cannot be in the future. Enter a time at or before now.",
    );
  });

  it("identifies a future end field", () => {
    expect(() =>
      assertProductionRunTimesNotFuture(
        {
          startTime: new Date("2026-07-15T11:00:00.000Z"),
          endTime: new Date("2026-07-15T12:00:00.001Z"),
        },
        NOW,
      ),
    ).toThrow(
      "End time cannot be in the future. Enter a time at or before now.",
    );
  });

  it("identifies both offending fields", () => {
    expect(() =>
      assertProductionRunTimesNotFuture(
        {
          startTime: new Date("2026-07-15T12:00:00.001Z"),
          endTime: new Date("2026-07-15T13:00:00.000Z"),
        },
        NOW,
      ),
    ).toThrow(
      "Start time and end time cannot be in the future. Enter times at or before now.",
    );
  });
});
