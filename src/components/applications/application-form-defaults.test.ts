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
  it("caps a browser day ahead of the facility at facility today", () => {
    process.env.TZ = "Asia/Tokyo";
    expect(resolveApplicationDateDefault("America/Los_Angeles", new Date("2025-07-08T01:00Z"))).toBe("2025-07-07");
  });
  it("keeps browser today when the facility is ahead", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(resolveApplicationDateDefault("Asia/Tokyo", new Date("2025-07-08T20:00Z"))).toBe("2025-07-08");
  });
});
