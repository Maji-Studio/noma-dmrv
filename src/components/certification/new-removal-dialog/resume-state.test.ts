import { describe, expect, it } from "vitest";
import {
  allowsRemovalSubmission,
  blocksRemovalResume,
  shouldBlockRemovalResume,
} from "./resume-state";

describe("blocksRemovalResume", () => {
  it("allows a submitted Removal to reopen for an idempotent or superseding resubmission", () => {
    expect(blocksRemovalResume("submitted")).toBe(false);
  });

  it("still blocks a Removal while a submission attempt is in progress", () => {
    expect(blocksRemovalResume("inProgress")).toBe(true);
  });

  it("keeps the submit step mounted when its local mutation owns the live lock", () => {
    expect(shouldBlockRemovalResume("inProgress", true)).toBe(false);
    expect(shouldBlockRemovalResume("inProgress", false)).toBe(true);
  });

  it("allows the submit control for both a ready draft and a submitted Removal", () => {
    expect(allowsRemovalSubmission("ready")).toBe(true);
    expect(allowsRemovalSubmission("submitted")).toBe(true);
    expect(allowsRemovalSubmission("blocked")).toBe(false);
    expect(allowsRemovalSubmission("inProgress")).toBe(false);
  });
});
