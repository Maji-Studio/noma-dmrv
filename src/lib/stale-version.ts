/**
 * Expected-version (optimistic concurrency) vocabulary, shared by the server
 * updaters, the React Query hooks and the edit forms (issue #768).
 *
 * Edit forms send the integer `expectedVersion` they loaded. A mismatch carries the stale-version conflict
 * through ActionResult; hooks rethrow StaleVersionError so the open form keeps
 * the operator's draft.
 *
 * Kept free of server-only imports so client components can use it.
 */

import {
  ConflictError,
  conflictCode,
  type ConflictRef,
} from "@/lib/conflict-ref";
import { ActionError, type ActionFailure } from "@/lib/action-error";

/**
 * Discriminator on `ActionResult["conflict"].code` for a refused stale save.
 * Every other conflict puts the conflicting record's human code in that slot,
 * so this sentinel must stay a value no entity code can take (lowercase with a
 * hyphen; entity codes are `^[A-Z0-9-]+$`).
 */
export const STALE_VERSION_CONFLICT_CODE = conflictCode("stale-version");

/** The one message every entity shows when its version check refuses a save. */
export const STALE_VERSION_MESSAGE =
  "This record changed since you opened it. Your changes were not saved. Review the latest values before saving again.";

/** State the refused deletion and the next action using the record's code. */
export function staleDeleteMessage(recordLabel: string): string {
  return `${recordLabel} was not deleted. It changed since the list loaded. Review it before deleting.`;
}

/** Structured reference to the record whose version moved on. */
export type StaleVersionConflict = ConflictRef;

/**
 * Thrown by a mutation hook when the server refused a save because the record
 * changed underneath the open form. Distinct from a plain `Error` so the form
 * can keep the draft instead of treating it as an ordinary save failure.
 */
export class StaleVersionError extends ActionError {
  declare readonly conflict: StaleVersionConflict;

  constructor(message: string, conflict: StaleVersionConflict, details: Omit<ActionFailure, "error" | "conflict"> = {}) {
    super({ ...details, error: message, conflict });
    this.name = "StaleVersionError";
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
  result: ActionFailure,
): boolean {
  return result.conflict?.code === STALE_VERSION_CONFLICT_CODE;
}

/**
 * Throw a failed action result from a mutation hook, preserving a stale-version
 * refusal as `StaleVersionError` and any other conflicting record as
 * `ConflictError`. Every branch carries the full refusal as an `ActionError`.
 */
export function throwActionError(result: ActionFailure): never {
  if (result.conflict && isStaleVersionFailure(result)) {
    throw new StaleVersionError(result.error, result.conflict, result);
  }
  if (result.conflict) {
    throw new ConflictError(result.error, {
      ...result,
      conflict: result.conflict,
    });
  }
  throw new ActionError(result);
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

/** Message for a refused delete, preserving other server errors and fallbacks. */
export function toDeleteErrorMessage(error: unknown, recordLabel: string, fallback: string): string {
  if (getStaleVersionConflict(error)) return staleDeleteMessage(recordLabel);
  return error instanceof Error ? error.message : fallback;
}

/** Message for a refused archive or restore, preserving other errors and fallbacks. */
export function toArchiveRestoreErrorMessage(
  error: unknown,
  recordLabel: string,
  action: "archive" | "restore",
  fallback: string,
): string {
  if (getStaleVersionConflict(error)) {
    const outcome = action === "archive" ? "archived" : "restored";
    const retry = action === "archive" ? "archiving" : "restoring";
    return `${recordLabel} was not ${outcome}. It changed since the list loaded. Review it before ${retry}.`;
  }
  return error instanceof Error ? error.message : fallback;
}
