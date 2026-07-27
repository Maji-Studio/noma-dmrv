import { describe, expect, it } from "vitest";
import { deriveRemovalEvidenceHealth } from "./removal-evidence-health";

describe("deriveRemovalEvidenceHealth", () => {
  it("awaits sync for a submitted Removal without current verification", () => {
    expect(
      deriveRemovalEvidenceHealth({
        submissionId: "submission-1",
        submissionVersion: 1,
        submissionStatus: "submitted",
        removalMetadata: null,
      }),
    ).toEqual({
      state: "awaiting_sync",
      label: "Awaiting sync",
      verifiedCount: 0,
      totalCount: 0,
    });
  });

  it.each([
    ["verified", "Verified"],
    ["awaiting_sync", "Awaiting sync"],
    ["mismatch", "Mismatch"],
  ] as const)("surfaces %s only for the current submission", (state, label) => {
    expect(
      deriveRemovalEvidenceHealth({
        submissionId: "submission-2",
        submissionVersion: 2,
        submissionStatus: "submitted",
        removalMetadata: {
          sourceBindingVerification: {
            submissionId: "submission-2",
            submissionVersion: 2,
            state,
            checkedAt: "2026-07-27T10:00:00.000Z",
            verifiedCount: state === "verified" ? 3 : 1,
            totalCount: 3,
          },
        },
      }),
    ).toEqual({
      state,
      label,
      verifiedCount: state === "verified" ? 3 : 1,
      totalCount: 3,
    });
  });

  it("does not treat an older submission's verified result as current", () => {
    expect(
      deriveRemovalEvidenceHealth({
        submissionId: "submission-2",
        submissionVersion: 2,
        submissionStatus: "submitted",
        removalMetadata: {
          sourceBindingVerification: {
            submissionId: "submission-1",
            submissionVersion: 1,
            state: "verified",
            checkedAt: "2026-07-27T09:00:00.000Z",
            verifiedCount: 3,
            totalCount: 3,
          },
        },
      }),
    ).toMatchObject({ state: "awaiting_sync", label: "Awaiting sync" });
  });

  it("has no post-submit attachment status for a draft", () => {
    expect(
      deriveRemovalEvidenceHealth({
        submissionId: "submission-1",
        submissionVersion: 1,
        submissionStatus: "draft",
        removalMetadata: null,
      }),
    ).toBeNull();
  });

  it.each([
    { verifiedCount: -1, totalCount: 3 },
    { verifiedCount: 1.5, totalCount: 3 },
    { verifiedCount: 4, totalCount: 3 },
    { verifiedCount: 1, totalCount: -1 },
    { verifiedCount: 1, totalCount: 3, state: "verified" },
  ])("fails closed for impossible persisted counts %#", (invalid) => {
    expect(
      deriveRemovalEvidenceHealth({
        submissionId: "submission-2",
        submissionVersion: 2,
        submissionStatus: "submitted",
        removalMetadata: {
          sourceBindingVerification: {
            submissionId: "submission-2",
            submissionVersion: 2,
            state: "awaiting_sync",
            checkedAt: "2026-07-27T10:00:00.000Z",
            ...invalid,
          },
        },
      }),
    ).toEqual({
      state: "awaiting_sync",
      label: "Awaiting sync",
      verifiedCount: 0,
      totalCount: 0,
    });
  });
});
