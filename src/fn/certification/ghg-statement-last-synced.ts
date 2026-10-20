import {
  appendSyncEvents,
  getLastSyncedAtForEntities,
  type AppendSyncEventInput,
} from "@/data-access/certifier-sync-events";
import type { OrgContext } from "@/lib/auth/server";
import { logger } from "@/lib/log";
import { sanitizeErrorMessage } from "@/lib/log/sanitize";
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
 * Write staged events once the mirror transaction settled: commit events in ONE
 * insert (the helper writes through the pooled root `db`), rollback diagnostics
 * one by one. Best-effort like every sync event: a failed audit write is logged
 * and never fails the sync.
 */
export async function flushStagedSyncEvents(
  orgCtx: OrgContext,
  staged: { committed: AppendSyncEventInput[]; rolledBack: AppendSyncEventInput[] },
  phase: "commit" | "rollback",
): Promise<void> {
  const events = phase === "commit" ? staged.committed : staged.rolledBack;
  if (events.length === 0) return;
  try {
    await appendSyncEvents(orgCtx, events);
  } catch (err) {
    logger.warn(
      { op: GHG_STATEMENT_SYNC_OPERATION, count: events.length, err: sanitizeErrorMessage(err) },
      "failed to record certifier sync events",
    );
  }
}
