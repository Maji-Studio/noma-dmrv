import { describe, expect, it } from "vitest";

import {
  hasExactGhgEntryMembership,
} from "./ghg-statement-breakdown";

describe("hasExactGhgEntryMembership", () => {
  it("accepts the same membership regardless of registry order", () => {
    expect(
      hasExactGhgEntryMembership(
        ["rmv_local_1", "rmv_local_2"],
        ["rmv_local_2", "rmv_local_1"],
      ),
    ).toBe(true);
  });

  it("rejects an unknown remote statement member", () => {
    expect(
      hasExactGhgEntryMembership(
        ["rmv_local_1"],
        ["rmv_local_1", "rmv_unknown"],
      ),
    ).toBe(false);
  });

  it("rejects missing and duplicate memberships", () => {
    expect(hasExactGhgEntryMembership([], [])).toBe(false);
    expect(
      hasExactGhgEntryMembership(
        ["rmv_local_1", "rmv_local_1"],
        ["rmv_local_1"],
      ),
    ).toBe(false);
  });
});
