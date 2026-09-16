/**
 * Expected-version (optimistic concurrency) vocabulary, shared by the server
 * updaters, the React Query hooks and the edit forms (issue #768).
 *
 * A consequential edit form sends the `updatedAt` it loaded as
 * `expectedUpdatedAt`. The updater compares it against the row it locked and,
 * when they differ, throws an `ActionConflictError` carrying
 * `code: STALE_VERSION_CONFLICT_CODE`. `withAction` turns that into
 * `{ success: false, error, conflict }`, the mutation hook re-throws it as
 * `StaleVersionError`, and the form shows the message next to its submit while
 * keeping every value the operator typed.
 *
 * Kept free of server-only imports so client components can use it.
 */

/**
 * Discriminator on `ActionResult["conflict"].code` for a refused stale save.
 * Every other conflict puts the conflicting record's human code in that slot,
 * so this sentinel must stay a value no entity code can take (lowercase with a
 * hyphen; entity codes are `^[A-Z0-9-]+$`).
 */
export const STALE_VERSION_CONFLICT_CODE = "stale-version";

/** The one message every entity shows when its version check refuses a save. */
export const STALE_VERSION_MESSAGE =
  "This record changed since you opened it. Your changes were not saved. Review the latest values before saving again.";

/** Structured reference to the record whose version moved on. */
export interface StaleVersionConflict {
  entity: string;
  id: string;
  code: string;
}

/** Failure half of `ActionResult`, narrowed to what the conflict check needs. */
interface ConflictCarryingFailure {
  error: string;
  conflict?: { entity: string; id: string; code: string };
}

/**
 * Thrown by a mutation hook when the server refused a save because the record
 * changed underneath the open form. Distinct from a plain `Error` so the form
 * can keep the draft instead of treating it as an ordinary save failure.
 */
export class StaleVersionError extends Error {
  readonly conflict: StaleVersionConflict;

  constructor(message: string, conflict: StaleVersionConflict) {
    super(message);
    this.name = "StaleVersionError";
    this.conflict = conflict;
  }
}

/** Return the conflict payload when `error` is a refused stale-version save. */
export function getStaleVersionConflict(
  error: unknown,
): StaleVersionConflict | null {
  return error instanceof StaleVersionError ? error.conflict : null;
}

/** True when a failed `ActionResult` was refused by the version check. */
export function isStaleVersionFailure(
  result: ConflictCarryingFailure,
): boolean {
  return result.conflict?.code === STALE_VERSION_CONFLICT_CODE;
}

/**
 * Throw a failed action result from a mutation hook, preserving a stale-version
 * refusal as a typed error. Anything else stays a plain `Error`, so the hooks
 * that already threw one behave exactly as before.
 */
export function throwActionError(result: ConflictCarryingFailure): never {
  if (result.conflict && isStaleVersionFailure(result)) {
    throw new StaleVersionError(result.error, result.conflict);
  }
  throw new Error(result.error);
}

/**
 * Message for an edit form's error banner: the shared stale-version copy when
 * the save was refused by the version check, otherwise the server's own message
 * or the caller's fallback.
 */
export function toSaveErrorMessage(error: unknown, fallback: string): string {
  if (getStaleVersionConflict(error)) return STALE_VERSION_MESSAGE;
  return error instanceof Error ? error.message : fallback;
}
