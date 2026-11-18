import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { certifierRemovals } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import { hasFreshRemovalDeletionLease } from "@/lib/certification/removal-deletion-lease";
import { requireOrgScope } from "./utils";

/** Fresh deletion leases for the requested Removals in this organization. */
export async function getDeletionLeasedRemovalIds(
  ctx: OrgContext,
  removalIds: readonly string[],
): Promise<Set<string>> {
  requireOrgScope(ctx);
  if (!removalIds.length) return new Set();
  const removals = await db.select({ id: certifierRemovals.id, metadata: certifierRemovals.metadata })
    .from(certifierRemovals).where(and(
      inArray(certifierRemovals.id, [...removalIds]),
      eq(certifierRemovals.organizationId, ctx.organizationId),
    ));
  return new Set(removals.filter((removal) => hasFreshRemovalDeletionLease(removal.metadata)).map((removal) => removal.id));
}

/** Caller holds the submission artifact lock through its draft decision. */
export async function isRemovalDeletionLeased(
  ctx: OrgContext,
  key: { localEntityType: string; localEntityId: string; provider: (typeof certifierRemovals.$inferSelect)["provider"] },
  tx: DbTransaction,
): Promise<boolean> {
  requireOrgScope(ctx);
  if (key.localEntityType !== "removal") return false;
  const [removal] = await tx.select({ metadata: certifierRemovals.metadata })
    .from(certifierRemovals).where(and(
      eq(certifierRemovals.id, key.localEntityId),
      eq(certifierRemovals.provider, key.provider),
      eq(certifierRemovals.organizationId, ctx.organizationId),
    )).limit(1);
  return hasFreshRemovalDeletionLease(removal?.metadata);
}
