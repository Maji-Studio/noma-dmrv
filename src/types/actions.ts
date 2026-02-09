/**
 * Standard result type for server actions
 * Provides type-safe success/error handling
 */
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
