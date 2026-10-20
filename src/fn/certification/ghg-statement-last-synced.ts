import {
  appendSyncEvents,
  getLastSyncedAtForEntities,
  type AppendSyncEventInput,
} from "@/data-access/certifier-sync-events";
import type { OrgContext } from "@/lib/auth/server";
import { logger } from "@/lib/log";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  ISOMETRIC_PROVIDER,
} from "@/lib/isometric/utils/constants";

export const GHG_STATEMENT_SYNC_OPERATION = "ghg_statement:sync";

export function getGhgStatementLastSyncedAt(
  ctx: OrgContext,
  statementIds: string[],
): Promise<Map<string, Date>> {
  return getLastSyncedAtForEntities(ctx, {
    provider: ISOMETRIC_PROVIDER,
    entityType: GHG_STATEMENT_ENTITY_TYPE,
    operation: GHG_STATEMENT_SYNC_OPERATION,
    entityIds: statementIds,
  });
}

/** Stage inside a transaction, or append best-effort after the mirror commits. */
export function ghgStatementSyncEvent(entityId: string): AppendSyncEventInput {
  return {
    provider: ISOMETRIC_PROVIDER,
    entityType: GHG_STATEMENT_ENTITY_TYPE,
    entityId,
    operation: GHG_STATEMENT_SYNC_OPERATION,
    status: "succeeded",
  };
}

/**
 * Record a sync for several statements in ONE insert, after the mirror
 * transaction committed (the helper writes through the pooled root `db`).
 * Best-effort like every sync event: a failed audit write never fails the sync.
 */
export async function recordGhgStatementSyncs(
  orgCtx: OrgContext,
  statementIds: string[],
): Promise<void> {
  try {
    await appendSyncEvents(orgCtx, statementIds.map(ghgStatementSyncEvent));
  } catch {
    // Drizzle errors embed bound params; never log them raw.
    logger.warn(
      { op: GHG_STATEMENT_SYNC_OPERATION, count: statementIds.length },
      "failed to record certifier sync events",
    );
  }
}
