import { afterEach, describe, expect, it } from "vitest";
import { formatSafeDate } from "@/lib/format-utils";

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe("formatSafeDate", () => {
  it("formats date-only strings as calendar dates without UTC drift", () => {
    process.env.TZ = "America/Los_Angeles";

    expect(formatSafeDate("2026-06-13")).toBe("Jun 13, 2026");
  });

  it("keeps timestamp formatting safe", () => {
    expect(formatSafeDate("2026-06-13T10:30:00.000Z", "yyyy-MM-dd")).toBe(
      "2026-06-13",
    );
  });

  it("returns a dash for invalid dates", () => {
    expect(formatSafeDate("2026-02-31")).toBe("—");
  });
});
