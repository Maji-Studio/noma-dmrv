import { afterEach, describe, expect, it } from "vitest";
import { formatLocalDate, parseLocalDateString } from "@/lib/date-utils";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

// #46 — a calendar day must parse at LOCAL midnight; `new Date("YYYY-MM-DD")`
// parses at UTC midnight, shifting the stored date back one day for users west
// of UTC. `parseLocalDateString` is the shared helper behind that fix, and it is
// what stamps a biochar product's production date from its linked run's date.
describe("parseLocalDateString", () => {
  it("parses a calendar day at local midnight", () => {
    const date = parseLocalDateString("2026-01-18");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(18);
    expect(date.getHours()).toBe(0);
  });

  it("preserves the calendar day in a timezone ahead of UTC", () => {
    process.env.TZ = "Europe/Zurich";
    const date = parseLocalDateString("2026-06-13");
    expect(formatLocalDate(date)).toBe("2026-06-13");
    // The same instant is the previous day in UTC — the bug we must not regress.
    expect(date.toISOString().slice(0, 10)).toBe("2026-06-12");
  });

  it("preserves the calendar day in a timezone behind UTC", () => {
    process.env.TZ = "America/Los_Angeles";
    const date = parseLocalDateString("2026-06-13");
    expect(formatLocalDate(date)).toBe("2026-06-13");
  });

  it("rejects an invalid calendar day", () => {
    expect(() => parseLocalDateString("2026-02-30")).toThrow();
  });
});
