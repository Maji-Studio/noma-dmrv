/**
 * Server half of the expected-version check (issue #768).
 *
 * Call it inside the updater's transaction, immediately after the row has been
 * read under `FOR UPDATE` (or under the advisory lock that serializes writes to
 * it), so the comparison cannot race the write it guards.
 */

import { ActionConflictError } from "@/lib/errors";
import {
  STALE_VERSION_CONFLICT_CODE,
  STALE_VERSION_MESSAGE,
} from "@/lib/stale-version";

interface ExpectedVersionCheck {
  /** Entity key carried to the client, e.g. `"facility"`. */
  entity: string;
  /** Id of the record being saved. */
  id: string;
  /** The `updatedAt` the form loaded. Omitted payloads skip the check. */
  expectedUpdatedAt: Date | undefined;
  /** The `updatedAt` of the row just locked. */
  actualUpdatedAt: Date;
}

/**
 * Refuse a save built on a stale read.
 *
 * Deliberately indifferent to which fields the payload carries: an edit that
 * only touches metadata is refused just as a mass edit is, because both write a
 * whole form's worth of values over whatever the other writer saved.
 *
 * `expectedUpdatedAt` is optional so callers that never loaded a version — the
 * quick-add paths, imports, and any client still on the previous payload — keep
 * saving unchanged.
 */
export function assertExpectedVersion({
  entity,
  id,
  expectedUpdatedAt,
  actualUpdatedAt,
}: ExpectedVersionCheck): void {
  if (!expectedUpdatedAt) return;
  if (expectedUpdatedAt.getTime() === actualUpdatedAt.getTime()) return;

  throw new ActionConflictError(STALE_VERSION_MESSAGE, {
    entity,
    id,
    code: STALE_VERSION_CONFLICT_CODE,
  });
}
