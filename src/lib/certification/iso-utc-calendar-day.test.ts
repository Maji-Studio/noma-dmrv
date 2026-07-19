import { describe, expect, it } from "vitest";
import { toIsoUtcCalendarDay } from "./iso-utc-calendar-day";

describe("toIsoUtcCalendarDay", () => {
  it.each([
    ["exact date-only", "2026-01-12", "2026-01-12"],
    ["Date input", new Date("2026-01-12T23:59:59.000Z"), "2026-01-12"],
    ["uppercase T timestamp", "2026-01-12T08:00:00.000Z", "2026-01-12"],
    ["lowercase t timestamp", "2026-01-12t08:00:00.000Z", "2026-01-12"],
    ["space-separated offset timestamp", "2026-01-12 08:00:00+02:00", "2026-01-12"],
    ["offset crossing a UTC day", "2026-01-12T00:30:00+02:00", "2026-01-11"],
  ] as const)("normalizes %s", (_, value, expected) => {
    expect(toIsoUtcCalendarDay(value)).toBe(expected);
  });

  it.each([
    ["invalid Date", new Date(Number.NaN)],
    ["invalid string", "not-a-date"],
    ["invalid date-only string", "2026-02-30"],
  ] as const)("returns null for an %s", (_, value) => {
    expect(toIsoUtcCalendarDay(value)).toBeNull();
  });
});
