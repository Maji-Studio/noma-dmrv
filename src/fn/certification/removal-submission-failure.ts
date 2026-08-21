import { markSubmissionInterrupted } from "@/data-access/certification-submissions";
import { rejectSubmissionAndReleaseProductionClaims } from "@/data-access/production-claim-reservations";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { Logger } from "@/lib/log";
import {
  getMetadataValue,
  SUBMISSION_EXTERNAL_MUTATIONS,
  SUBMISSION_METADATA_KEYS,
} from "@/lib/certification/submission-metadata";
import type { RegistryExternalMutation } from "./registry-create";

export type RemovalExternalMutation =
  | typeof SUBMISSION_EXTERNAL_MUTATIONS.none
  | RegistryExternalMutation;

const UNEXPECTED_REMOVAL_SUBMISSION_ERROR =
  "Removal submission failed unexpectedly. Retry the submission.";

export function readRemovalSubmissionExternalMutation(
  metadata: unknown,
): RemovalExternalMutation {
  const value = getMetadataValue(
    metadata,
    SUBMISSION_METADATA_KEYS.externalMutation,
  );
  return value === SUBMISSION_EXTERNAL_MUTATIONS.possible ||
    value === SUBMISSION_EXTERNAL_MUTATIONS.confirmed
    ? value
    : SUBMISSION_EXTERNAL_MUTATIONS.none;
}

export function recordRemovalExternalMutation(
  attempt: { externalMutation: RemovalExternalMutation },
  next: RegistryExternalMutation,
): void {
  if (
    next === SUBMISSION_EXTERNAL_MUTATIONS.confirmed ||
    attempt.externalMutation === SUBMISSION_EXTERNAL_MUTATIONS.none
  ) {
    attempt.externalMutation = next;
  }
}

export function safeRemovalSubmissionError(error: unknown): {
  errorClass: string | null;
  errorMessage: string | null;
} {
  if (error === null) {
    return { errorClass: null, errorMessage: null };
  }
  if (error instanceof SafeError) {
    return { errorClass: "SafeError", errorMessage: error.message };
  }
  return {
    errorClass: "UnexpectedError",
    errorMessage: UNEXPECTED_REMOVAL_SUBMISSION_ERROR,
  };
}

/**
 * Records a claimed Removal draft's orchestration error. Attempts with no
 * external mutation are rejected and unlocked; possible or confirmed writes
 * stay locked and are marked interrupted so retry can reconcile them safely.
 * Both data-access updates are draft-status and attempt-lock guarded.
 */
export async function recordClaimedRemovalSubmissionFailureBestEffort(args: {
  orgCtx: OrgContext;
  submissionId: string;
  expectedLockedAt: Date;
  externalMutation: RemovalExternalMutation;
  error: unknown;
  log: Logger;
}): Promise<void> {
  const safeError = safeRemovalSubmissionError(args.error);
  const errorMessage =
    safeError.errorMessage ?? UNEXPECTED_REMOVAL_SUBMISSION_ERROR;
  try {
    if (args.externalMutation === SUBMISSION_EXTERNAL_MUTATIONS.none) {
      await rejectSubmissionAndReleaseProductionClaims(args.orgCtx, {
        submissionId: args.submissionId,
        errorMessage,
        expectedLockedAt: args.expectedLockedAt,
      });
    } else {
      const recorded = await markSubmissionInterrupted(
        args.orgCtx,
        args.submissionId,
        {
          errorMessage,
          expectedLockedAt: args.expectedLockedAt,
          externalMutation: args.externalMutation,
        },
      );
      if (!recorded) {
        args.log.warn(
          {
            submissionId: args.submissionId,
            externalMutation: args.externalMutation,
          },
          "interrupted state lost: submission lock no longer held (row re-claimed or re-locked); external registry write may be unrecorded",
        );
      }
    }
  } catch (cleanupError) {
    args.log.warn(
      {
        submissionId: args.submissionId,
        cleanupErrorName:
          cleanupError instanceof Error
            ? cleanupError.name
            : typeof cleanupError,
      },
      "failed to persist claimed removal submission failure",
    );
  }
}
