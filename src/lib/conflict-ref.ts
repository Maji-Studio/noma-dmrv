/**
 * Structured reference to a record that blocks a save (decision 2026-09-17).
 *
 * A refused action names the record it collides with so a form can link the
 * operator straight to it, and may list further `blockers` that also stand in
 * the way. `code` is the label the operator reads. The brand proves only that
 * it is not blank, not that it is a stored record code. Known exceptions are
 * documented in docs/architecture.md. Kept free of server-only imports so
 * client components can use it.
 */

declare const CONFLICT_CODE_BRAND: unique symbol;

/** An operator-readable label, proven non-blank by `conflictCode()`. */
export type ConflictCode = string & { readonly [CONFLICT_CODE_BRAND]: true };

/** Structured reference to a record a refused save points at. */
export interface ConflictRef {
  entity: string;
  id: string;
  code: ConflictCode;
}

/** Failure payload that carries one conflicting record and optional blockers. */
export interface ConflictPayload {
  conflict: ConflictRef;
  /** Further records that stand in the way, in display order. */
  blockers?: ConflictRef[];
}

/**
 * Brand an operator-readable label for a conflict payload. Throws a plain `Error` on a
 * blank value: a conflict without a readable code is a programming error, not
 * an operator-facing condition.
 */
export function conflictCode(value: string): ConflictCode {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("A conflict must carry the record's code.");
  }
  return trimmed as ConflictCode;
}

/**
 * Thrown by a mutation hook when the server refused a save because of another
 * record. Distinct from a plain `Error` so the form can show detail about
 * the records the refusal named.
 */
export class ConflictError extends Error implements ConflictPayload {
  readonly conflict: ConflictRef;
  readonly blockers?: ConflictRef[];

  constructor(message: string, payload: ConflictPayload) {
    super(message);
    this.name = "ConflictError";
    this.conflict = payload.conflict;
    if (payload.blockers) this.blockers = payload.blockers;
  }
}

/** Return the conflict payload when `error` is a refused save with a conflicting record. */
export function getConflict(error: unknown): ConflictPayload | null {
  return error instanceof ConflictError
    ? { conflict: error.conflict, blockers: error.blockers }
    : null;
}
