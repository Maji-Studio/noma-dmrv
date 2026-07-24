import type { OrgContext } from "@/lib/auth/server";
import { sanitizeErrorMessage } from "@/lib/log";
import {
  appendSyncEventBestEffort,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
} from "./shared";

interface SourceSyncEventArgs {
  documentId: string;
  removalId: string;
  operation: string;
  requestPayload?: unknown;
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
    await Promise.all([
      appendSyncEventBestEffort(orgCtx, {
        ...common,
        entityType: "document",
        entityId: args.documentId,
        requestPayload: args.requestPayload,
      }),
      appendSyncEventBestEffort(orgCtx, {
        ...common,
        entityType: REMOVAL_ENTITY_TYPE,
        entityId: args.removalId,
        requestPayload: {
          ...((args.requestPayload as Record<string, unknown> | undefined) ?? {}),
          documentId: args.documentId,
        },
      }),
    ]);
    throw error;
  }
}
