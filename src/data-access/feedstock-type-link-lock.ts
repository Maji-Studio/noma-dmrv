import { db, type DbTransaction } from "@/db";
import { feedstocks, feedstockTypes, productionRunFeedstocks } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { and, eq } from "drizzle-orm";
import { getRecordLocks } from "./certification-lineage-guards";
import { requireOrgScope } from "./utils";

export interface FeedstockTypeLinkLock {
  locked: boolean;
  removals: { id: string; label?: string }[];
}

/** Advisory read, also used inside the feedstock-type update transaction. */
export async function getFeedstockTypeLinkLock(
  ctx: OrgContext,
  tx: Pick<DbTransaction, "select" | "selectDistinct">,
  feedstockTypeId: string,
): Promise<FeedstockTypeLinkLock> {
  requireOrgScope(ctx);
  const [type] = await tx
    .select({ id: feedstockTypes.id })
    .from(feedstockTypes)
    .where(and(
      eq(feedstockTypes.id, feedstockTypeId),
      eq(feedstockTypes.organizationId, ctx.organizationId),
    ));
  if (!type) throw new SafeError("Feedstock type not found.");

  const runs = await tx
    .selectDistinct({ id: productionRunFeedstocks.productionRunId })
    .from(productionRunFeedstocks)
    .innerJoin(feedstocks, and(
      eq(feedstocks.id, productionRunFeedstocks.feedstockId),
      eq(feedstocks.organizationId, ctx.organizationId),
    ))
    .where(and(
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
      eq(feedstocks.feedstockTypeId, feedstockTypeId),
    ))
    .orderBy(productionRunFeedstocks.productionRunId);

  // Resolve registry facts once for all runs, rather than once per run.
  const locks = await getRecordLocks(ctx, tx, runs.map(run => ({
    entityType: "productionRun",
    entityId: run.id,
  })), { sentOnly: true });
  const removals = new Map<string, FeedstockTypeLinkLock["removals"][number]>();
  for (const lock of locks) {
    if (lock.level !== "sent") continue;
    for (const holder of lock.heldBy) {
      if (holder.kind !== "removal") continue;
      removals.set(holder.id, {
        id: holder.id,
        ...(holder.label ? { label: holder.label } : {}),
      });
    }
  }
  return {
    locked: locks.some(lock => lock.level === "sent"),
    removals: [...removals.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** The advisory read as the edit sheet asks for it, outside any transaction. */
export async function readFeedstockTypeLinkLock(
  ctx: OrgContext,
  feedstockTypeId: string,
): Promise<FeedstockTypeLinkLock> {
  return getFeedstockTypeLinkLock(ctx, db, feedstockTypeId);
}
