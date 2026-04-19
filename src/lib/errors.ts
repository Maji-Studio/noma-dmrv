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
