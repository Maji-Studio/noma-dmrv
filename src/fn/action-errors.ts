import { SafeError, toActionError } from "@/lib/errors";
import { logger, sanitizeErrorMessage } from "@/lib/log";

interface LogActionErrorOptions {
  context?: Record<string, unknown>;
  message: string;
}

const DATABASE_SCHEMA_MISMATCH_CODES = new Set([
  "42703", // undefined_column
  "42P01", // undefined_table
  "42704", // undefined_object
  "42883", // undefined_function
]);

/**
 * Detect the PostgreSQL errors that mean the running application expects a
 * database object which is not present. Drizzle wraps the original pg error in
 * `cause`, so walk the chain without exposing its SQL or identifiers.
 */
export function isDatabaseSchemaMismatchError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current = error;

  while (
    typeof current === "object" &&
    current !== null &&
    !visited.has(current)
  ) {
    visited.add(current);
    const candidate = current as { cause?: unknown; code?: unknown };

    if (
      typeof candidate.code === "string" &&
      DATABASE_SCHEMA_MISMATCH_CODES.has(candidate.code)
    ) {
      return true;
    }

    current = candidate.cause;
  }

  return false;
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
