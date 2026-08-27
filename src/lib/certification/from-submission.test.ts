import { describe, expect, it } from "vitest";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import {
  deriveSubmissionStatus,
  overlayLiveRemoteStatus,
} from "./from-submission";

const row = (metadata: Record<string, unknown> | null) =>
  ({
    id: "sub-1",
    status: "submitted",
    metadata,
  }) as CertificationSubmissionRow;

describe("overlayLiveRemoteStatus", () => {
  // DR-002 / #685 regression: the badge derived from a stale persisted
  // remoteStatus while the technical pane showed the live fetch, so one sheet
  // said "In registry" and "AWAITING_VERIFICATION" at once. One response,
  // one registry truth.
  it("patches the live status into a copy, leaving the original untouched", () => {
    const original = row({ remoteStatus: "DRAFT" });
    const overlaid = overlayLiveRemoteStatus(original, "AWAITING_VERIFICATION");

    expect(
      (overlaid.metadata as Record<string, unknown>).remoteStatus,
    ).toBe("AWAITING_VERIFICATION");
    expect(
      (original.metadata as Record<string, unknown>).remoteStatus,
    ).toBe("DRAFT");
  });

  it("feeds the badge derivation the same status the pane shows", () => {
    const overlaid = overlayLiveRemoteStatus(
      row({ remoteStatus: "DRAFT" }),
      "VERIFIED",
    );
    const derived = deriveSubmissionStatus(overlaid, false, "ghgStatement");
    expect(derived.kind).toBe("verified");
  });

  it("returns the row unchanged for a matching, unknown, or missing status", () => {
    const matching = row({ remoteStatus: "DRAFT" });
    expect(overlayLiveRemoteStatus(matching, "DRAFT")).toBe(matching);

    const unknown = row({ remoteStatus: "DRAFT" });
    expect(overlayLiveRemoteStatus(unknown, "SOMETHING_NEW")).toBe(unknown);

    const absent = row({ remoteStatus: "DRAFT" });
    expect(overlayLiveRemoteStatus(absent, null)).toBe(absent);
  });

  it("tolerates a row without metadata", () => {
    const overlaid = overlayLiveRemoteStatus(row(null), "DRAFT");
    expect(
      (overlaid.metadata as Record<string, unknown>).remoteStatus,
    ).toBe("DRAFT");
  });
});

describe("deriveSubmissionStatus", () => {
  it("surfaces a submitted Removal with no reporting window as interrupted", () => {
    const derived = deriveSubmissionStatus(
      row(null),
      false,
      "removal",
      { startedOn: null, completedOn: null },
    );
    expect(derived).toMatchObject({
      kind: "interrupted",
      isActionable: true,
      isTerminal: false,
    });
  });

  it("keeps a submitted Removal terminal when both dates exist", () => {
    const derived = deriveSubmissionStatus(
      row(null),
      false,
      "removal",
      { startedOn: "2026-01-01", completedOn: "2026-04-05" },
    );
    expect(derived.kind).toBe("submitted");
  });
});
