/**
 * Value-shaped `claimSubmissionDraft` fake for pipeline (fn/) tests.
 *
 * Runs the REAL pure claim policy (`decideSubmissionClaim`) over the test's
 * in-memory row store, so version/supersede/idempotency assertions exercise
 * the same decisions production takes — but the I/O choreography the module
 * owns (mapping lock and CAS semantics) is deliberately NOT simulated here.
 * The in-lock `resolve` callback is still invoked for create-new-version so
 * compiler → claimed snapshot → POST agreement is exercised at the pipeline
 * seam. Lock behavior itself is DB-backed in certification-submissions.test.ts.
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
import type { OrgContext } from "@/lib/auth/server";

export interface FakeLedgerStore {
  latest: (key: SubmissionKey) => CertificationSubmissionRow | null;
  insert: (input: InsertDraftSubmissionInput) => CertificationSubmissionRow;
  resetToDraft: (rowId: string) => CertificationSubmissionRow;
}

export function makeClaimSubmissionDraftFake(store: FakeLedgerStore) {
  return async <H>(
    _ctx: OrgContext,
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
        if (
          claim.reason === "dataupload-orphan-restart" ||
          claim.reason === "dataupload-rejected-restart"
        ) {
          throw new Error(
            `Fake claim: ${claim.reason} is unreachable without dataUploadResume`,
          );
        }
        const inputs = args.resolve
          ? await args.resolve({} as never, args.tentativeInputs)
          : args.tentativeInputs;
        const finalHash = args.hashOf(inputs);
        const locked = decideSubmissionClaim({
          latest: store.latest(args.key),
          payloadHash: finalHash,
          now: Date.now(),
          lockTtlMs: LOCK_TTL_MS,
          policy: args.policy,
        });
        if (locked.kind !== "create-new-version") {
          throw new Error(
            `Fake claim: resolve changed create outcome to ${locked.kind}`,
          );
        }
        if (
          locked.reason === "dataupload-orphan-restart" ||
          locked.reason === "dataupload-rejected-restart"
        ) {
          throw new Error(
            `Fake claim: ${locked.reason} is unreachable without dataUploadResume`,
          );
        }
        const snapshot = args.buildSnapshot({
          inputs,
          nextVersion: locked.nextVersion,
          supersedePreviousId: locked.supersedePreviousId,
          reason: locked.reason,
        });
        const row = store.insert({
          ...args.key,
          version: locked.nextVersion,
          payloadSnapshot: snapshot.payloadSnapshot,
          payloadHash: finalHash,
          metadata: snapshot.metadata ?? null,
        });
        return {
          kind: "claimed",
          row,
          resumed: false,
          supersedePreviousId: locked.supersedePreviousId,
          reason: locked.reason,
        };
      }
      default:
        throw new Error(`Fake claim: unexpected claim kind ${claim.kind}`);
    }
  };
}
