/**
 * Value-shaped `claimSubmissionDraft` fake for pipeline (fn/) tests.
 *
 * Runs the REAL pure claim policy (`decideSubmissionClaim`) over the test's
 * in-memory row store, so version/supersede/idempotency assertions exercise
 * the same decisions production takes — but the I/O choreography the module
 * owns (mapping lock, mirror locks, in-lock `resolve` re-resolution, CAS
 * semantics) is deliberately NOT simulated here. That behavior is tested
 * DB-backed against real Postgres in tests/certification-submissions.test.ts
 * (ADR 0008); `buildSnapshot` is invoked with the tentative inputs.
 */
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { decideSubmissionClaim } from "@/lib/isometric/utils/submission-claim";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import type {
  ClaimOutcome,
  ClaimSubmissionDraftArgs,
  InsertDraftSubmissionInput,
  SubmissionKey,
} from "@/data-access/certification-submissions";

export interface FakeLedgerStore {
  latest: (key: SubmissionKey) => CertificationSubmissionRow | null;
  insert: (input: InsertDraftSubmissionInput) => CertificationSubmissionRow;
  resetToDraft: (rowId: string) => CertificationSubmissionRow;
}

export function makeClaimSubmissionDraftFake(store: FakeLedgerStore) {
  return async <H>(
    _userId: string,
    args: ClaimSubmissionDraftArgs<H>,
  ): Promise<ClaimOutcome> => {
    const payloadHash = args.hashOf(args.tentativeInputs);
    const claim = decideSubmissionClaim({
      latest: store.latest(args.key),
      payloadHash,
      now: Date.now(),
      lockTtlMs: LOCK_TTL_MS,
      policy: args.policy,
    });

    switch (claim.kind) {
      case "blocked-in-flight":
        return { kind: "blocked", reason: "in-flight" };
      case "blocked-rejected-with-external":
        return { kind: "blocked", reason: "rejected-with-external" };
      case "invalid-changed-hash":
        return { kind: "blocked", reason: "invalid-changed-hash" };
      case "return-existing":
        return {
          kind: "existing",
          externalId: claim.externalId,
          version: claim.version,
        };
      case "resume":
        return {
          kind: "claimed",
          row: store.resetToDraft(claim.resumeRowId),
          resumed: true,
          supersedePreviousId: null,
          reason: "resumed",
        };
      case "create-new-version": {
        if (claim.reason === "dataupload-orphan-restart") {
          throw new Error(
            "Fake claim: dataupload-orphan-restart is unreachable without dataUploadResume",
          );
        }
        const snapshot = args.buildSnapshot({
          inputs: args.tentativeInputs,
          nextVersion: claim.nextVersion,
          supersedePreviousId: claim.supersedePreviousId,
          reason: claim.reason,
        });
        const row = store.insert({
          ...args.key,
          version: claim.nextVersion,
          payloadSnapshot: snapshot.payloadSnapshot,
          payloadHash,
          metadata: snapshot.metadata ?? null,
        });
        return {
          kind: "claimed",
          row,
          resumed: false,
          supersedePreviousId: claim.supersedePreviousId,
          reason: claim.reason,
        };
      }
      default:
        throw new Error(`Fake claim: unexpected claim kind ${claim.kind}`);
    }
  };
}
