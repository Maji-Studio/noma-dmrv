import { SafeError, toActionError } from "@/lib/errors";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import type { ZodError } from "zod";

interface LogActionErrorOptions {
  context?: Record<string, unknown>;
  message: string;
}

const DEFAULT_ZOD_ACTION_ERROR = "Check the highlighted fields.";

function asSentence(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

export function formatZodActionError(
  error: ZodError,
  context?: string,
): string {
  const messages = [
    ...new Set(
      error.issues
        .map((issue) => issue.message.trim())
        .filter((message) => message.length > 0),
    ),
  ].map(asSentence);
  const issueText = messages.join(" ") || DEFAULT_ZOD_ACTION_ERROR;

  if (!context) return issueText;
  return `${context.trim().replace(/[:.\s]+$/, "")}: ${issueText}`;
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
