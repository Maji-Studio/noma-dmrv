/**
 * Client-safe carrier for a production-run overlap conflict (issue #259).
 *
 * The server action returns `{ success: false, error, conflict }` on an
 * overlapping time window. The React Query mutation hooks re-throw that as this
 * typed error so the form can pull the message onto the start-time field and
 * link straight to the conflicting run. Kept free of server-only imports so it
 * is safe to use in client components.
 */

export interface RunConflict {
  entity: string;
  id: string;
  code: string;
}

export class ProductionRunConflictError extends Error {
  readonly conflict: RunConflict;
  constructor(message: string, conflict: RunConflict) {
    super(message);
    this.name = "ProductionRunConflictError";
    this.conflict = conflict;
  }
}

/** Return the conflict payload if `err` is a production-run overlap error. */
export function getRunConflict(err: unknown): RunConflict | null {
  return err instanceof ProductionRunConflictError ? err.conflict : null;
}
