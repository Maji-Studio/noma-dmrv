import type { AppendSyncEventInput } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";

import { appendSyncEventBestEffort } from "./shared";

/**
 * Audit writes that must not run while a business transaction is open.
 *
 * `appendSyncEvent` (`src/data-access/certifier-sync-events.ts`) always
 * inserts through the root pooled `db` — it takes no executor. Calling it from
 * inside `db.transaction` therefore asks the pool for a *second* connection
 * while the transaction still owns one. At the default pool size
 * (`DEFAULT_DB_POOL_MAX` is 1, `src/db/pool-config.ts`) that request can only
 * ever time out, and `appendSyncEventBestEffort` swallows the timeout: the
 * audit row is silently lost and the mirror stalls for the full acquisition
 * timeout first.
 *
 * So events are staged in a closure while the transaction is held and flushed
 * once it settles. Success rows are written only if the transaction committed;
 * failure diagnostics are written only if it rolled back — the reverse of
 * writing through `tx`, which would discard exactly the diagnostics that
 * explain the rollback.
 */
export interface SyncEventStage {
  /** Write this event after the surrounding transaction commits. */
  onCommit(
    input: AppendSyncEventInput,
    logContext?: Record<string, unknown>,
  ): void;
  /** Write this diagnostic after the surrounding transaction rolls back. */
  onRollback(
    input: AppendSyncEventInput,
    logContext?: Record<string, unknown>,
  ): void;
}

type FlushPhase = "commit" | "rollback";

interface StagedSyncEvent {
  phase: FlushPhase;
  input: AppendSyncEventInput;
  logContext?: Record<string, unknown>;
}

/**
 * Run `work` and flush whatever it staged once the work settles.
 *
 * The original error is rethrown untouched after the rollback flush, so the
 * caller still sees the failure that unwound the transaction. Flushing is
 * best-effort in both directions: a failed audit insert never fails the work
 * and never undoes it.
 */
export async function withStagedSyncEvents<T>(
  orgCtx: OrgContext,
  work: (stage: SyncEventStage) => Promise<T>,
): Promise<T> {
  const staged: StagedSyncEvent[] = [];
  const stage: SyncEventStage = {
    onCommit(input, logContext) {
      staged.push({ phase: "commit", input, logContext });
    },
    onRollback(input, logContext) {
      staged.push({ phase: "rollback", input, logContext });
    },
  };

  let result: T;
  try {
    result = await work(stage);
  } catch (error) {
    await flushStagedSyncEvents(orgCtx, staged, "rollback");
    throw error;
  }
  await flushStagedSyncEvents(orgCtx, staged, "commit");
  return result;
}

/**
 * Written in staging order so an operator reading the sync-event history sees
 * the same sequence the mirror attempted. Volume is a handful of rows per
 * mirror, so the serial writes cost nothing next to the Isometric round trips
 * that produced them.
 */
async function flushStagedSyncEvents(
  orgCtx: OrgContext,
  staged: readonly StagedSyncEvent[],
  phase: FlushPhase,
): Promise<void> {
  for (const event of staged) {
    if (event.phase !== phase) continue;
    // `appendSyncEventBestEffort` already swallows insert failures; this guard
    // covers everything else on the path (logger, serialization) so a broken
    // audit trail can never surface as a failed mirror.
    try {
      await appendSyncEventBestEffort(orgCtx, event.input, event.logContext);
    } catch {
      // Intentionally ignored: the audit trail is never load-bearing here.
    }
  }
}
