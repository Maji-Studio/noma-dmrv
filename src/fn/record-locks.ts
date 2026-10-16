"use server";
import { z } from "zod";
import { getRecordLockViews, getStorageBinLockViews } from "@/data-access/record-lock-views";
import { RECORD_LOCK_VIEW_KINDS, RECORD_LOCK_VIEW_MAX_IDS, type RecordLockViewKind, type RecordLockViews } from "@/lib/record-lock-view";
import { withAction } from "./with-action";

const recordLocksSchema = z.object({
  entityType: z.enum(RECORD_LOCK_VIEW_KINDS),
  ids: z.array(z.uuid()).max(RECORD_LOCK_VIEW_MAX_IDS),
});

/** Advisory Open, In use or Sent for one list page or one sheet. Writers re-check. */
export async function loadRecordLocks(entityType: RecordLockViewKind, ids: string[]) {
  return withAction<RecordLockViews>((ctx) => {
    const input = recordLocksSchema.parse({ entityType, ids });
    return input.entityType === "storageLocation"
      ? getStorageBinLockViews(ctx, input.ids)
      : getRecordLockViews(ctx, input.entityType, input.ids);
  }, { fallbackMessage: "Record locks could not be loaded." });
}
