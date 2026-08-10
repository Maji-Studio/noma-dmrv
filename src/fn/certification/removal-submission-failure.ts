import { markSubmissionRejected } from "@/data-access/certification";
import { markSubmissionInterrupted } from "@/data-access/certification-submissions";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { Logger } from "@/lib/log";
import type { RegistryExternalMutation } from "./registry-create";

const UNEXPECTED_REMOVAL_SUBMISSION_ERROR =
  "Removal submission failed unexpectedly. Retry the submission.";

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
export async function rejectClaimedRemovalSubmissionBestEffort(args: {
  orgCtx: OrgContext;
  submissionId: string;
  expectedLockedAt: Date;
  externalMutation: "none" | RegistryExternalMutation;
  error: unknown;
  log: Logger;
}): Promise<void> {
  const safeError = safeRemovalSubmissionError(args.error);
  const errorMessage =
    safeError.errorMessage ?? UNEXPECTED_REMOVAL_SUBMISSION_ERROR;
  try {
    if (args.externalMutation === "none") {
      await markSubmissionRejected(args.orgCtx, args.submissionId, {
        errorMessage,
        expectedLockedAt: args.expectedLockedAt,
      });
    } else {
      await markSubmissionInterrupted(args.orgCtx, args.submissionId, {
        errorMessage,
        expectedLockedAt: args.expectedLockedAt,
        externalMutation: args.externalMutation,
      });
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
