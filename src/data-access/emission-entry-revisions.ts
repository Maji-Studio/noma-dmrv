import { and, eq, inArray } from "drizzle-orm";
import { certifierRemovals, creditBatchApplications } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordLockRemoval } from "@/lib/record-lock";
import { emissionCorrectionBatchIds } from "./emission-entry-corrections";
import { readRecordLockLineage } from "./record-lock-lineage";
import { requireOrgScope, type Executor } from "./utils";

/** The correction union's persisted facts, solely for revision announcements.
 * A partial read is unknown (null), never an empty (apparently open) lineage.
 * A failed query throws: callers pass write transactions, and a caught error
 * would leave the transaction aborted.
 */
export async function loadPersistedEmissionCorrectionLineages(ctx: OrgContext, executor: Executor, batchIds: readonly string[]) {
  requireOrgScope(ctx);
  const reads = new Map<string, Promise<RecordLockRemoval[] | null>>();
  return new Map(await Promise.all([...new Set(batchIds)].map(async batchId => {
    const union = await emissionCorrectionBatchIds(ctx, executor, batchId);
      const key = JSON.stringify([...union].sort());
      if (!reads.has(key)) reads.set(key, (async () => {
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
      })());
    return [batchId, await reads.get(key)!] as const;
  })));
}
