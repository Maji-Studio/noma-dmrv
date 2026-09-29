import { SafeError } from "@/lib/errors";
import type { IsometricClient, PaginateOptions } from "./client";

/**
 * How a lookup treats more than one matching record.
 * - `first` stops at the first match. Use it when the path filters server-side
 *   or when any match will do, so a lookup does not pay for pages it ignores.
 * - `unique` walks every page and refuses a second record with a different id.
 *   Use it when a duplicate reference must stop the caller.
 */
export type RegistryRecordMatch =
  | { match: "first" }
  | { match: "unique"; duplicateMessage: string };

export type RegistryRecordLookup<T> = RegistryRecordMatch & {
  /** Client-side filter, applied even when the path also filters server-side. */
  where: (record: T) => boolean;
  /** Server-side query, page size and page cap for the walk. */
  paginate?: PaginateOptions;
};

/**
 * Finds one record in a Certify list. Paging bounds and cursor checks come
 * from `client.paginate`; this adds only the match policy.
 */
export async function findRegistryRecord<T extends { id: string }>(
  client: IsometricClient,
  path: string,
  lookup: RegistryRecordLookup<T>,
): Promise<T | null> {
  let found: T | null = null;
  for await (const record of client.paginate<T>(path, lookup.paginate)) {
    if (!lookup.where(record)) continue;
    if (lookup.match === "first") return record;
    if (found && found.id !== record.id) {
      throw new SafeError(lookup.duplicateMessage);
    }
    found = record;
  }
  return found;
}
