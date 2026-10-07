import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { DomainError } from "@/lib/domain-errors";
import { STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";

/** Pure guard: call immediately after reading the scoped row FOR UPDATE. */
export function assertRowVersion({ entity, id, expectedVersion, actualVersion }: {
  entity: string;
  id: string;
  expectedVersion: number;
  actualVersion: number;
}): void {
  if (expectedVersion === actualVersion) return;
  throw new DomainError("stale_version", STALE_VERSION_MESSAGE, {
    conflict: { entity, id, code: STALE_VERSION_CONFLICT_CODE },
  });
}

/** Increment atomically in the same statement as every represented row change. */
export function nextVersion(column: AnyPgColumn): SQL<number> {
  return sql<number>`${column} + 1`;
}
