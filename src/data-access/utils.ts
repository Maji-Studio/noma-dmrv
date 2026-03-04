/**
 * Shared utilities for data-access layer
 */

/**
 * Require user to be authenticated.
 * Throws if userId is falsy.
 */
export function requireAuth(userId: string): void {
  if (!userId) {
    throw new Error("Unauthorized");
  }
}
