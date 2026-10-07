import { DomainError } from "@/lib/domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import { formatValidationIssues } from "@/lib/validation-message";
import { STALE_VERSION_CONFLICT_CODE } from "@/lib/stale-version";
import { ActionConflictError, SafeError, toActionError } from "@/lib/errors";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import type { ActionResult } from "@/types/actions";
import { ZodError } from "zod";

interface LogActionErrorOptions {
  context?: Record<string, unknown>;
  message: string;
}

/** The failure half of `ActionResult`, shared by every server entry point. */
export type ActionFailure = Extract<ActionResult<never>, { success: false }>;

interface ActionFailureOptions {
  /** Fallback message when the error is not safe to show verbatim. */
  fallbackMessage: string;
  /** Structured log line for unexpected errors (Zod and conflicts are not). */
  log: LogActionErrorOptions;
  /** Optional task-specific context for ZodError messages. */
  zodErrorPrefix?: string;
}



/**
 * A body result whose work has a committed part and a non-fatal follow-up:
 * a preference that was not stored, an enrichment read that failed.
 */
export interface ResultWithWarning<T> {
  data: T;
  warning?: string;
}

/**
 * Format a committed result, keeping any follow-up warning on the success
 * branch. The commit is known, so this is never a failure (issue #769).
 */
export function toWarnableSuccess<T>({
  data,
  warning,
}: ResultWithWarning<T>): ActionResult<T> {
  return warning ? { success: true, data, warning } : { success: true, data };
}

export function formatZodActionError(error: ZodError, context?: string): string {
  return formatValidationIssues(error.issues, context);
}

export function logActionError(
  error: unknown,
  { context, message }: LogActionErrorOptions,
): void {
  if (error instanceof SafeError) return;

  logger.error(
    {
      ...(context ?? {}),
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: sanitizeErrorMessage(error),
    },
    message,
  );
}

export function toLoggedActionError(
  error: unknown,
  fallbackMessage: string,
  logOptions: LogActionErrorOptions,
): string {
  logActionError(error, logOptions);
  return toActionError(error, fallbackMessage);
}

/**
 * Convert a thrown error into the shared `ActionResult` failure shape: Zod
 * issues become one readable sentence, an `ActionConflictError` keeps its
 * structured `conflict`, and anything else is logged and replaced by the
 * fallback. Both server entry points use it (`withAction` for Server Actions,
 * `readResponse` for the `/api/reads/*` handlers) so the two transports cannot
 * drift apart.
 */
export function toActionFailure(
  error: unknown,
  { fallbackMessage, log, zodErrorPrefix }: ActionFailureOptions,
): ActionFailure {
  if (error instanceof DomainError) {
    return {
      success: false,
      error: error.message,
      code: error.code,
      ...(error.issues.length ? { issues: error.issues } : {}),
      ...(error.conflict ? { conflict: error.conflict } : {}),
      ...(error.blockers ? { blockers: error.blockers } : {}),
    };
  }
  if (error instanceof ZodError) {
    return {
      success: false,
      error: formatZodActionError(error, zodErrorPrefix),
      code: "validation_failed",
      issues: validationFailed(error).issues,
    };
  }
  if (error instanceof ActionConflictError) {
    return {
      success: false,
      error: error.message,
      code: error.conflict.code === STALE_VERSION_CONFLICT_CODE ? "stale_version" : "conflict",
      conflict: error.conflict,
      ...(error.blockers ? { blockers: error.blockers } : {}),
    };
  }
  logActionError(error, log);
  return { success: false, error: toActionError(error, fallbackMessage) };
}
