import { and, eq, inArray } from "drizzle-orm";
import { certifierRemovals, creditBatchApplications } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { readPerCorrectionUnion } from "./emission-entry-corrections";
import { readRecordLockLineage } from "./record-lock-lineage";
import { requireOrgScope, type Executor } from "./utils";

/** The correction union's persisted facts, solely for revision announcements.
 * A partial read is unknown (null), never an empty (apparently open) lineage.
 * A failed query throws: callers pass write transactions, and a caught error
 * would leave the transaction aborted.
 */
export async function loadPersistedEmissionCorrectionLineages(ctx: OrgContext, executor: Executor, batchIds: readonly string[]) {
  requireOrgScope(ctx);
  return readPerCorrectionUnion(ctx, executor, batchIds, async union => {
    const members = await executor.select({ removalId: creditBatchApplications.removalId,
      id: certifierRemovals.id, ghgStatementId: certifierRemovals.ghgStatementId,
    }).from(creditBatchApplications)
      .leftJoin(certifierRemovals, and(eq(certifierRemovals.id, creditBatchApplications.removalId), eq(certifierRemovals.organizationId, ctx.organizationId)))
      .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.creditBatchId, union)));
    const holders = [...new Map(members.filter(row => row.removalId).map(row => [row.removalId!, row])).values()];
    if (holders.some(holder => !holder.id)) return null;
    const lineage = await readRecordLockLineage(ctx, executor, holders.map(holder => ({ removalId: holder.removalId!, ghgStatementId: holder.ghgStatementId })));
    if (holders.some(holder => {
      const fact = lineage.find(item => item.id === holder.removalId);
      return !fact || !!holder.ghgStatementId && !fact.statements.some(statement => statement.id === holder.ghgStatementId);
    })) return null;
    return lineage;
  });
}
