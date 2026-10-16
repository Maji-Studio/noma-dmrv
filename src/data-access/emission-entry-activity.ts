import type { DbTransaction } from "@/db";
import type { emissionEntries, emissionEntryValues } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { recordActivityChange, type ActivityEventInput } from "./activity-events";
import { requireOrgScope } from "./utils";

type EntrySnapshot = typeof emissionEntries.$inferSelect & {
  values: (typeof emissionEntryValues.$inferSelect)[];
};

/** Compare persisted entry content; values and notes record field names only. */
export async function recordEmissionEntryActivity(ctx: OrgContext, tx: DbTransaction,
  action: ActivityEventInput["action"], before: EntrySnapshot | null, after: EntrySnapshot) {
  requireOrgScope(ctx);
  await recordActivityChange(ctx, tx, { entityType: "emission_entry", entityId: after.id,
    creditBatchId: after.creditBatchId, action, source: "form" }, before, after);
}
