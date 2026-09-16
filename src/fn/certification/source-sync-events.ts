import type { AppendSyncEventInput } from "@/data-access/certification";
import type { OrgContext } from "@/lib/auth/server";
import { sanitizeErrorMessage } from "@/lib/log";
import {
  appendSyncEventBestEffort,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
} from "./shared";
import type { SyncEventStage } from "./sync-event-stage";

interface SourceSyncEventArgs {
  documentId: string;
  removalId: string;
  operation: string;
  requestPayload?: unknown;
  /**
   * Supplied when the call runs inside an open transaction. The diagnostics
   * are then staged and written after the transaction rolls back, because
   * `appendSyncEvent` inserts through the root pooled `db` and would otherwise
   * wait for a connection the transaction itself is holding. See
   * `./sync-event-stage`.
   */
  stage?: SyncEventStage;
}

/**
 * Preserve document-level diagnostics and also project failures onto the
 * removal history operators can see beside the Sources panel.
 */
export async function withSourceSyncEventOnFailure<T>(
  orgCtx: OrgContext,
  args: SourceSyncEventArgs,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error);
    const common = {
      provider: ISOMETRIC_PROVIDER,
      operation: args.operation,
      status: "failed" as const,
      errorMessage,
    };
    const events: AppendSyncEventInput[] = [
      {
        ...common,
        entityType: "document",
        entityId: args.documentId,
        requestPayload: args.requestPayload,
      },
      {
        ...common,
        entityType: REMOVAL_ENTITY_TYPE,
        entityId: args.removalId,
        requestPayload: {
          ...((args.requestPayload as Record<string, unknown> | undefined) ?? {}),
          documentId: args.documentId,
        },
      },
    ];
    if (args.stage) {
      for (const event of events) args.stage.onRollback(event);
    } else {
      await Promise.all(
        events.map((event) => appendSyncEventBestEffort(orgCtx, event)),
      );
    }
    throw error;
  }
}
