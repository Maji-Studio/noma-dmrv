import { afterEach, describe, expect, it } from "vitest";
import { resolveApplicationDateDefault, resolveApplicationEvidenceMethodDefault } from "./application-form-defaults";

describe("Application form organization defaults", () => {
  it("uses the selectable organization evidence default for new records", () => {
    expect(resolveApplicationEvidenceMethodDefault(undefined, "boundary")).toBe(
      "boundary",
    );
  });

  it("falls back when an organization still stores the unavailable visual default", () => {
    expect(resolveApplicationEvidenceMethodDefault(undefined, "visual")).toBe(
      "location",
    );
  });

  it("preserves a saved legacy visual method while editing", () => {
    expect(resolveApplicationEvidenceMethodDefault("visual", "boundary")).toBe(
      "visual",
    );
  });
});

describe("application date default", () => {
  const originalTz = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTz; });
  it("uses facility today when the browser is ahead", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(resolveApplicationDateDefault("America/Los_Angeles", new Date("2025-07-08T01:00Z"))).toBe("2025-07-07");
  });
  it("uses facility today when the facility is ahead", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(resolveApplicationDateDefault("Asia/Tokyo", new Date("2025-07-08T20:00Z"))).toBe("2025-07-09");
  });
});

it("uses Dar today and passes the application future-date cap", async () => {
  const { assertApplicationDate } = await import("@/lib/application-write-rules");
  const now = new Date("2026-10-21T22:00:00Z");
  const zone = "Africa/Dar_es_Salaam";
  const day = resolveApplicationDateDefault(zone, now);
  expect(day).toBe("2026-10-22");
  expect(() => assertApplicationDate(new Date(day), new Date("2026-10-21T12:00:00Z"), zone, "DL-1", now)).not.toThrow();
});
