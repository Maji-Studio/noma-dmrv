import { describe, expect, it } from "vitest";
import { removalDateLine } from "./credit-batch-removal-bar";

describe("removalDateLine", () => {
  const createdAt = new Date("2026-10-01T12:00:00Z");
  const submittedAt = new Date("2026-10-12T12:00:00Z");

  it("dates a submitted Removal by its submission", () => {
    expect(removalDateLine({ phase: "submitted", submittedAt, createdAt })).toBe("Submitted Oct 12, 2026");
  });

  it("dates an interrupted submission, shown as a draft, by its creation", () => {
    expect(removalDateLine({ phase: "draft", submittedAt, createdAt })).toBe("Created Oct 1, 2026");
  });
});
