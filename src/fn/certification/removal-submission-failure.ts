import { markSubmissionRejected } from "@/data-access/certification";
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
 * Releases a claimed Removal draft after any definitive orchestration error.
 * The data-access update is draft-status-guarded, so this is harmless after a
 * registry boundary already rejected the row or a later seam sees it submitted.
 */
export async function rejectClaimedRemovalSubmissionBestEffort(args: {
  orgCtx: OrgContext;
  submissionId: string;
  expectedLockedAt: Date;
  externalMutation: "none" | RegistryExternalMutation;
  error: unknown;
  log: Logger;
}): Promise<void> {
  if (args.externalMutation !== "none") return;
  const safeError = safeRemovalSubmissionError(args.error);
  try {
    await markSubmissionRejected(args.orgCtx, args.submissionId, {
      errorMessage:
        safeError.errorMessage ?? UNEXPECTED_REMOVAL_SUBMISSION_ERROR,
      expectedLockedAt: args.expectedLockedAt,
    });
  } catch (cleanupError) {
    args.log.warn(
      {
        submissionId: args.submissionId,
        cleanupErrorName:
          cleanupError instanceof Error
            ? cleanupError.name
            : typeof cleanupError,
      },
      "failed to reject claimed removal submission",
    );
  }
}
