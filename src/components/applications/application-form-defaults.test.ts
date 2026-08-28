import { describe, expect, it } from "vitest";
import { resolveApplicationEvidenceMethodDefault } from "./application-form-defaults";

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
