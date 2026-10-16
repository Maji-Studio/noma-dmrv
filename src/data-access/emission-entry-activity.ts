import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { recordActivity, type ActivityEventInput } from "./activity-events";
import { requireOrgScope } from "./utils";

/** Keep the value-free entry audit contract in one place. */
export async function recordEmissionEntryActivity(ctx: OrgContext, tx: DbTransaction,
  entry: { id: string; creditBatchId: string }, action: ActivityEventInput["action"], changedFields: string[]) {
  requireOrgScope(ctx);
  await recordActivity(ctx, tx, { entityType: "emission_entry", entityId: entry.id,
    creditBatchId: entry.creditBatchId, action, changedFields, source: "form" });
}
