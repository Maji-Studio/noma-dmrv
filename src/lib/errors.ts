/**
 * Errors that are safe to expose to clients verbatim.
 * Use this for intentional, user-facing validation/business rule errors.
 * Unexpected errors (DB failures, network errors, etc.) should use plain Error
 * so withAction can suppress their messages in production.
 */
export class SafeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeError";
  }
}

export class ActionConflictError extends SafeError {
  readonly conflict: { entity: string; id: string; code: string };

  constructor(
    message: string,
    conflict: { entity: string; id: string; code: string },
  ) {
    super(message);
    this.name = "ActionConflictError";
    this.conflict = conflict;
  }
}

/**
 * Convert an arbitrary server-side error into a client-safe action message.
 * Only intentional SafeError messages cross the server/client boundary.
 */
export function toActionError(
  error: unknown,
  fallbackMessage: string,
): string {
  if (error instanceof SafeError) return error.message;
  return fallbackMessage;
}
