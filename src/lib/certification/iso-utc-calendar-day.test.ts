import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { toIsoUtcCalendarDay } from "./iso-utc-calendar-day";

describe("toIsoUtcCalendarDay", () => {
  it.each([
    ["exact date-only", "2026-01-12", "2026-01-12"],
    ["Date input", new Date("2026-01-12T23:59:59.000Z"), "2026-01-12"],
    ["uppercase T timestamp", "2026-01-12T08:00:00.000Z", "2026-01-12"],
    ["lowercase t timestamp", "2026-01-12t08:00:00.000Z", "2026-01-12"],
    ["space-separated offset timestamp", "2026-01-12 08:00:00+02:00", "2026-01-12"],
    ["year zero timestamp", "0000-01-01T00:00:00Z", "0000-01-01"],
    ["positive offset UTC crossing", "2026-01-12T00:30:00+02:00", "2026-01-11"],
    ["negative offset UTC crossing", "2026-01-12T23:30:00-02:00", "2026-01-13"],
  ] as const)("normalizes %s", (_, value, expected) => {
    expect(toIsoUtcCalendarDay(value)).toBe(expected);
  });

  it("preserves an offset-less timestamp's lexical day under a non-UTC TZ", () => {
    const moduleUrl = new URL("./iso-utc-calendar-day.ts", import.meta.url).href;
    const script = `
      import helper from ${JSON.stringify(moduleUrl)};
      process.stdout.write(String(helper.toIsoUtcCalendarDay("2026-01-12T23:30:00")));
    `;
    const result = execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      {
        encoding: "utf8",
        env: { ...process.env, TZ: "America/Los_Angeles" },
      },
    );

    expect(result).toBe("2026-01-12");
  });

  it.each([
    ["invalid Date", new Date(Number.NaN)],
    ["invalid string", "not-a-date"],
    ["invalid date-only string", "2026-02-30"],
    ["impossible offset-less timestamp", "2026-02-30T00:00:00"],
    ["impossible zoned timestamp", "2026-02-30T00:00:00Z"],
    ["malformed timestamp", "2026-01-12T08:00:00Zjunk"],
    ["timestamp with an invalid time", "2026-01-12T24:00:00Z"],
    ["timestamp with an invalid offset", "2026-01-12T08:00:00+24:00"],
    ["year-9999 offset crossing", "9999-12-31T23:30:00-01:00"],
    ["Date beyond the four-digit year domain", new Date("+010000-01-01T00:00:00Z")],
  ] as const)("returns null for an %s", (_, value) => {
    expect(toIsoUtcCalendarDay(value)).toBeNull();
  });
});
