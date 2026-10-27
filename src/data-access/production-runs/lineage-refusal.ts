import type { DbTransaction } from "@/db";
import { productionRunFeedstockDraws } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";
import { withLockedFieldIssues } from "@/lib/record-lock-fields";
import { and, eq } from "drizzle-orm";
import { assertCanMutateCertifiedLineage } from "../certification-lineage-guards";
import { requireOrgScope } from "../utils";

/** Preserve the lineage refusal contract while naming the changed update fields. */
export async function assertProductionRunLineage(
  ctx: OrgContext, tx: DbTransaction, productionRunId: string,
  previous: object, changes: object,
): Promise<void> {
  requireOrgScope(ctx);
  await withLockedFieldIssues(() => withFeedstockErrors(() => assertCanMutateCertifiedLineage(
    ctx, tx, { entityType: "productionRun", entityId: productionRunId }, "update",
  ), "certification_locked"), async () => {
    if (!("feedstockDraws" in changes) || changes.feedstockDraws === undefined) return previous;
    const draws = await tx.select({
      storageLocationId: productionRunFeedstockDraws.storageLocationId,
      wetMassKg: productionRunFeedstockDraws.wetMassKg,
    }).from(productionRunFeedstockDraws).where(and(
      eq(productionRunFeedstockDraws.organizationId, ctx.organizationId),
      eq(productionRunFeedstockDraws.productionRunId, productionRunId),
    ));
    // Request order owns issue indices; compare the saved draw in that order.
    const requested = changes.feedstockDraws as { storageLocationId: string }[];
    const order = new Map(requested.map((draw, index) => [draw.storageLocationId, index]));
    draws.sort((a, b) => (order.get(a.storageLocationId) ?? requested.length) - (order.get(b.storageLocationId) ?? requested.length));
    return { ...previous, feedstockDraws: draws };
  }, changes);
}
