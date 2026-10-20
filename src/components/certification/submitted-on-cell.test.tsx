import { describe, expect, it } from "vitest";
import { submittedOnText } from "./submitted-on-cell";

describe("submittedOnText", () => {
  it("formats a submitted date with the shared date format", () => {
    expect(
      submittedOnText({ kind: "submitted", at: new Date(2026, 9, 2, 12) }),
    ).toBe("Oct 2, 2026");
  });

  it("says Not submitted for a row never submitted", () => {
    expect(submittedOnText({ kind: "never" })).toBe("Not submitted");
  });

  it("says Not recorded for a statement the registry already held", () => {
    expect(submittedOnText({ kind: "registryDiscovered" })).toBe("Not recorded");
  });
});
