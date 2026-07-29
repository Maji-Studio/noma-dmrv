import { SafeError, toActionError } from "@/lib/errors";
import { logger, sanitizeErrorMessage } from "@/lib/log";

interface LogActionErrorOptions {
  context?: Record<string, unknown>;
  message: string;
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
