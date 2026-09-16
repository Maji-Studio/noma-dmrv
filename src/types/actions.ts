/**
 * Standard result type for server actions
 * Provides type-safe success/error handling
 */
export type ActionResult<T> =
  | {
      success: true;
      data: T;
      /**
       * Set when the write committed but a non-fatal follow-up did not: a
       * preference that could not be saved, an enrichment read that failed.
       * The result is still a success, because the commit is known, so a
       * consumer that only reads `data` is unaffected (issue #769). Never use
       * it to describe a rollback.
       */
      warning?: string;
    }
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
