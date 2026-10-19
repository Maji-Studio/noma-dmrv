import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { certifierRemovals, creditBatchApplications } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { GRAMS_PER_KG, massGrams } from "@/lib/calculations/gram-allocation";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { requireOrgScope } from "./utils";

/** What the credit batch timeline's hover card shows per batch. All mass is dry biochar kg. */
export interface CreditBatchTimelineFacts {
  creditBatchId: string;
  facilityId: string;
  /** Null when a member production run has no recorded dry mass. */
  producedDryKg: number | null;
  appliedDryKg: number;
  /** Applied mass whose frozen slice belongs to no Removal yet. */
  notInRemovalDryKg: number;
  /** Codes of the Removals holding a slice of this batch, sorted. */
  removalCodes: string[];
}

/**
 * Timeline facts for many credit batches in set-based queries (one rollup walk
 * plus one slice query), the batched counterpart of the credit batch page
 * model's mass block. Batches outside the caller's organization are absent from
 * the result.
 */
export async function listCreditBatchTimelineFacts(
  ctx: OrgContext,
  batchIds: string[],
): Promise<Record<string, CreditBatchTimelineFacts>> {
  requireOrgScope(ctx);
  const ids = [...new Set(batchIds)];
  if (ids.length === 0) return {};
  const [rollups, slices] = await Promise.all([
    loadCreditBatchRollups(ctx, ids),
    db
      .select({
        creditBatchId: creditBatchApplications.creditBatchId,
        removalId: creditBatchApplications.removalId,
        removalCode: certifierRemovals.code,
        dryKg: creditBatchApplications.allocatedDryMassKg,
      })
      .from(creditBatchApplications)
      .leftJoin(
        certifierRemovals,
        and(
          eq(certifierRemovals.id, creditBatchApplications.removalId),
          eq(certifierRemovals.organizationId, ctx.organizationId),
        ),
      )
      .where(
        and(
          inArray(creditBatchApplications.creditBatchId, ids),
          eq(creditBatchApplications.organizationId, ctx.organizationId),
        ),
      ),
  ]);

  const facts: Record<string, CreditBatchTimelineFacts> = {};
  for (const id of ids) {
    const rollup = rollups[id];
    if (!rollup) continue;
    const mine = slices.filter((slice) => slice.creditBatchId === id);
    const runs = rollup.lineageFacts.runs;
    const producedGrams =
      runs.length > 0 && runs.every((run) => run.biocharDryMassKg !== null)
        ? runs.reduce((sum, run) => sum + massGrams(run.biocharDryMassKg!), 0)
        : null;
    const sumGrams = (rows: typeof mine) => rows.reduce((sum, row) => sum + massGrams(row.dryKg), 0);
    facts[id] = {
      creditBatchId: id,
      facilityId: rollup.batch.facilityId,
      producedDryKg: producedGrams === null ? null : producedGrams / GRAMS_PER_KG,
      appliedDryKg: sumGrams(mine) / GRAMS_PER_KG,
      notInRemovalDryKg: sumGrams(mine.filter((slice) => slice.removalId === null)) / GRAMS_PER_KG,
      removalCodes: [...new Set(mine.flatMap((slice) => (slice.removalCode ? [slice.removalCode] : [])))].sort(),
    };
  }
  return facts;
}
