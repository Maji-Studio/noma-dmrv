import { and, eq, isNotNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { creditBatchApplications } from "@/db/schema/credits";
import type { OrgContext } from "@/lib/auth/server";
import { gcRemovalIfOrphaned } from "./certifier-removals";
import { requireOrgScope } from "./utils";

export async function deleteCreditBatchApplicationSlices(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
): Promise<void> {
  requireOrgScope(ctx);
  const ownedSlices = await tx
    .select({ removalId: creditBatchApplications.removalId })
    .from(creditBatchApplications)
    .where(
      and(
        eq(creditBatchApplications.creditBatchId, creditBatchId),
        isNotNull(creditBatchApplications.removalId),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    );
  const removalIds = [
    ...new Set(
      ownedSlices
        .map((slice) => slice.removalId)
        .filter((removalId): removalId is string => removalId != null),
    ),
  ];

  await tx
    .delete(creditBatchApplications)
    .where(
      and(
        eq(creditBatchApplications.creditBatchId, creditBatchId),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    );
  for (const removalId of removalIds) {
    await gcRemovalIfOrphaned(ctx, tx, removalId);
  }
}
