import { describe, expect, it } from "vitest";
import {
  decideSubmissionClaim,
  type SubmissionClaimPolicy,
  type SubmissionClaimRow,
  type SubmissionClaimStatus,
} from "@/lib/isometric/utils/submission-claim";

const NOW = 1_700_000_000_000;
const LOCK_TTL_MS = 10 * 60 * 1000;
const HASH = "hash-current";
const OTHER_HASH = "hash-different";

const SUPERSEDE: SubmissionClaimPolicy = { onSubmittedHashChanged: "supersede" };
const INVALID: SubmissionClaimPolicy = {
  onSubmittedHashChanged: "invalid-changed-hash",
};

function row(overrides: Partial<SubmissionClaimRow>): SubmissionClaimRow {
  return {
    id: "sub_1",
    status: "draft",
    version: 1,
    payloadHash: HASH,
    externalId: null,
    lockedAt: null,
    ...overrides,
  };
}

describe("decideSubmissionClaim", () => {
  it("creates the first version when no prior submission exists", () => {
    for (const policy of [SUPERSEDE, INVALID]) {
      expect(
        decideSubmissionClaim({
          latest: null,
          payloadHash: HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy,
        }),
      ).toEqual({
        kind: "create-new-version",
        nextVersion: 1,
        supersedePreviousId: null,
        reason: "first",
      });
    }
  });

  describe("draft", () => {
    it("blocks in-flight when lockedAt is within the TTL", () => {
      const latest = row({
        status: "draft",
        lockedAt: new Date(NOW - (LOCK_TTL_MS - 1)),
      });
      for (const policy of [SUPERSEDE, INVALID]) {
        expect(
          decideSubmissionClaim({
            latest,
            payloadHash: HASH,
            now: NOW,
            lockTtlMs: LOCK_TTL_MS,
            policy,
          }),
        ).toEqual({ kind: "blocked-in-flight" });
      }
    });

    it("resumes at the TTL boundary (strict less-than)", () => {
      const latest = row({
        status: "draft",
        lockedAt: new Date(NOW - LOCK_TTL_MS),
        version: 3,
      });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: SUPERSEDE,
        }),
      ).toEqual({ kind: "resume", resumeRowId: "sub_1", resumeVersion: 3 });
    });

    it("resumes when lockedAt is null", () => {
      const latest = row({ status: "draft", lockedAt: null, version: 2 });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: SUPERSEDE,
        }),
      ).toEqual({ kind: "resume", resumeRowId: "sub_1", resumeVersion: 2 });
    });

    it("resumes a long-stale draft (lockedAt 11 minutes ago)", () => {
      const elevenMinutesAgo = new Date(NOW - 11 * 60 * 1000);
      const latest = row({ status: "draft", lockedAt: elevenMinutesAgo });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: INVALID,
        }),
      ).toMatchObject({ kind: "resume" });
    });
  });

  describe("submitted", () => {
    it("returns existing on matching hash + externalId set", () => {
      const latest = row({
        status: "submitted",
        externalId: "ext_42",
        version: 3,
      });
      for (const policy of [SUPERSEDE, INVALID]) {
        expect(
          decideSubmissionClaim({
            latest,
            payloadHash: HASH,
            now: NOW,
            lockTtlMs: LOCK_TTL_MS,
            policy,
          }),
        ).toEqual({
          kind: "return-existing",
          externalId: "ext_42",
          version: 3,
        });
      }
    });

    it("falls through to policy when hash matches but externalId is null (defensive)", () => {
      const latest = row({
        status: "submitted",
        externalId: null,
        version: 2,
      });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: SUPERSEDE,
        }),
      ).toEqual({
        kind: "create-new-version",
        nextVersion: 3,
        supersedePreviousId: "sub_1",
        reason: "submitted-hash-changed",
      });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: INVALID,
        }),
      ).toEqual({ kind: "invalid-changed-hash" });
    });

    it("supersedes on different hash with policy=supersede", () => {
      const latest = row({
        status: "submitted",
        externalId: "ext_42",
        version: 4,
      });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: OTHER_HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: SUPERSEDE,
        }),
      ).toEqual({
        kind: "create-new-version",
        nextVersion: 5,
        supersedePreviousId: "sub_1",
        reason: "submitted-hash-changed",
      });
    });

    it("rejects on different hash with policy=invalid-changed-hash", () => {
      const latest = row({
        status: "submitted",
        externalId: "ext_42",
        version: 4,
      });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: OTHER_HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: INVALID,
        }),
      ).toEqual({ kind: "invalid-changed-hash" });
    });
  });

  describe("accepted", () => {
    it("returns existing on matching hash + externalId set", () => {
      const latest = row({
        status: "accepted",
        externalId: "ext_99",
        version: 7,
      });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: INVALID,
        }),
      ).toEqual({
        kind: "return-existing",
        externalId: "ext_99",
        version: 7,
      });
    });

    it("supersedes on different hash with policy=supersede", () => {
      const latest = row({
        status: "accepted",
        externalId: "ext_99",
        version: 7,
      });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: OTHER_HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: SUPERSEDE,
        }),
      ).toEqual({
        kind: "create-new-version",
        nextVersion: 8,
        supersedePreviousId: "sub_1",
        reason: "submitted-hash-changed",
      });
    });

    it("rejects on different hash with policy=invalid-changed-hash", () => {
      const latest = row({
        status: "accepted",
        externalId: "ext_99",
        version: 7,
      });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: OTHER_HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: INVALID,
        }),
      ).toEqual({ kind: "invalid-changed-hash" });
    });
  });

  describe("rejected", () => {
    it("blocks when externalId is set (must resolve in registry)", () => {
      const latest = row({
        status: "rejected",
        externalId: "ext_77",
      });
      for (const policy of [SUPERSEDE, INVALID]) {
        expect(
          decideSubmissionClaim({
            latest,
            payloadHash: HASH,
            now: NOW,
            lockTtlMs: LOCK_TTL_MS,
            policy,
          }),
        ).toEqual({ kind: "blocked-rejected-with-external" });
      }
    });

    it("resumes when unlinked and hash matches", () => {
      const latest = row({
        status: "rejected",
        externalId: null,
        version: 2,
      });
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy: SUPERSEDE,
        }),
      ).toEqual({ kind: "resume", resumeRowId: "sub_1", resumeVersion: 2 });
    });

    it("creates a new version (no superseded pointer) when unlinked and hash differs", () => {
      const latest = row({
        status: "rejected",
        externalId: null,
        version: 2,
      });
      for (const policy of [SUPERSEDE, INVALID]) {
        expect(
          decideSubmissionClaim({
            latest,
            payloadHash: OTHER_HASH,
            now: NOW,
            lockTtlMs: LOCK_TTL_MS,
            policy,
          }),
        ).toEqual({
          kind: "create-new-version",
          nextVersion: 3,
          supersedePreviousId: null,
          reason: "rejected-hash-changed",
        });
      }
    });
  });

  it("creates a new version (no superseded pointer) when latest is superseded", () => {
    const latest = row({ status: "superseded", version: 5 });
    for (const policy of [SUPERSEDE, INVALID]) {
      expect(
        decideSubmissionClaim({
          latest,
          payloadHash: HASH,
          now: NOW,
          lockTtlMs: LOCK_TTL_MS,
          policy,
        }),
      ).toEqual({
        kind: "create-new-version",
        nextVersion: 6,
        supersedePreviousId: null,
        reason: "after-superseded",
      });
    }
  });

  it("is deterministic across repeated calls with the same input", () => {
    const latest = row({
      status: "submitted",
      externalId: "ext_1",
      version: 9,
    });
    const input = {
      latest,
      payloadHash: OTHER_HASH,
      now: NOW,
      lockTtlMs: LOCK_TTL_MS,
      policy: SUPERSEDE,
    };
    expect(decideSubmissionClaim(input)).toEqual(decideSubmissionClaim(input));
  });

  it("rejects an unknown status at runtime (assertNever guard)", () => {
    const latest = row({
      status: "wat" as unknown as SubmissionClaimStatus,
    });
    expect(() =>
      decideSubmissionClaim({
        latest,
        payloadHash: HASH,
        now: NOW,
        lockTtlMs: LOCK_TTL_MS,
        policy: SUPERSEDE,
      }),
    ).toThrowError(/Unhandled submission status: wat/);
  });
});
