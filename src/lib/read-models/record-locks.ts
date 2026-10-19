import { z } from "zod";

import { getRecordLockViews, getRemovalLockViews, getStorageBinLockViews } from "@/data-access/record-lock-views";
import type { OrgContext } from "@/lib/auth/server";
import { RECORD_LOCK_VIEW_KINDS, RECORD_LOCK_VIEW_MAX_IDS, type RecordLockViewKind, type RecordLockViews } from "@/lib/record-lock-view";
import { uuidSchema } from "@/schemas/helpers";

const recordLocksReadSchema = z.object({
  entityType: z.enum(RECORD_LOCK_VIEW_KINDS),
  // Lower-cased, so ids compare with what PostgreSQL returns.
  ids: z.array(uuidSchema()).max(RECORD_LOCK_VIEW_MAX_IDS),
});

export interface RecordLocksReadInput {
  entityType: RecordLockViewKind;
  ids: readonly string[];
}

/**
 * Advisory Open, In use or Sent for one list page or one sheet. Writers
 * re-check under their own locks; foreign or unknown ids are absent.
 */
export async function readRecordLocks(ctx: OrgContext, input: unknown): Promise<RecordLockViews> {
  const { entityType, ids } = recordLocksReadSchema.parse(input);
  if (entityType === "storageLocation") return getStorageBinLockViews(ctx, ids);
  if (entityType === "removal") return getRemovalLockViews(ctx, ids);
  return getRecordLockViews(ctx, entityType, ids);
}
