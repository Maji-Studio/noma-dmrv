import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { creditBatchApplications, creditBatches, emissionEntries } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

/** Caller fences the attempt or Removal. Lock all batches by id before any entries. */
export async function lockBatchesThenEntries(ctx: OrgContext, tx: DbTransaction, args: {
  removalId: string;
  entryFilter: SQL;
  extraBatchFilter?: SQL;
}) {
  requireOrgScope(ctx);
  const members = await tx.select({ creditBatchId: creditBatchApplications.creditBatchId }).from(creditBatchApplications)
    .where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.removalId, args.removalId)));
  const entries = await tx.select({ creditBatchId: emissionEntries.creditBatchId }).from(emissionEntries)
    .where(and(eq(emissionEntries.organizationId, ctx.organizationId), args.entryFilter));
  const batchIds = [...new Set([...members, ...entries].map(row => row.creditBatchId))];
  if (batchIds.length || args.extraBatchFilter) {
    await tx.select({ id: creditBatches.id }).from(creditBatches).where(and(
      eq(creditBatches.organizationId, ctx.organizationId),
      or(args.extraBatchFilter, batchIds.length ? inArray(creditBatches.id, batchIds) : undefined),
    )).orderBy(creditBatches.id).for("update");
  }
  return tx.select().from(emissionEntries).where(and(
    eq(emissionEntries.organizationId, ctx.organizationId), args.entryFilter,
  )).orderBy(emissionEntries.id).for("update");
}
