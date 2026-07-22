import { describe, expect, it } from "vitest";
import { formatDayString } from "./format-utils";

describe("formatDayString", () => {
  it("formats a YYYY-MM-DD day without reparsing into an instant", () => {
    expect(formatDayString("2026-08-01")).toBe("Aug 1, 2026");
    expect(formatDayString("2026-12-25")).toBe("Dec 25, 2026");
  });

  it("returns the fallback for null, undefined, or malformed input", () => {
    expect(formatDayString(null)).toBe("—");
    expect(formatDayString(undefined)).toBe("—");
    expect(formatDayString("")).toBe("—");
    expect(formatDayString("2026-08-01T12:00:00Z")).toBe("—");
    expect(formatDayString("2026-13-01")).toBe("—");
  });
});
