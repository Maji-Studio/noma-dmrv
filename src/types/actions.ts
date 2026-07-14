/**
 * Standard result type for server actions
 * Provides type-safe success/error handling
 */
export type ActionResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      /**
       * Optional structured reference to a conflicting entity, so a form can
       * link the operator straight to it (e.g. the production run whose time
       * window overlaps — issue #259). Backwards-compatible: consumers that
       * only read `error` are unaffected.
       */
      conflict?: { entity: string; id: string; code: string };
    };
