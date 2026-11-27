import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { certificationSubmissions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

type BatchClaim = {
  id: string;
  productionEmissionsClaimedByRemovalId: string | null;
  productionEmissionsClaimReservedBySubmissionId: string | null;
};

/** First-send reservations identify the owning Removal before the permanent claim is stamped. */
export async function loadBatchProductionRelativeRemovals(
  ctx: OrgContext, batches: readonly BatchClaim[],
  reader: Pick<DbTransaction, "select"> = db,
): Promise<Map<string, string | null>> {
  requireOrgScope(ctx);
  const reservationIds = [...new Set(batches.flatMap(batch =>
    batch.productionEmissionsClaimedByRemovalId === null && batch.productionEmissionsClaimReservedBySubmissionId
      ? [batch.productionEmissionsClaimReservedBySubmissionId] : []))];
  const submissions = reservationIds.length ? await reader.select({
    id: certificationSubmissions.id, removalId: certificationSubmissions.localEntityId,
  }).from(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId),
    eq(certificationSubmissions.localEntityType, "removal"),
    inArray(certificationSubmissions.id, reservationIds),
  )) : [];
  const reservedRemovals = new Map(submissions.map(row => [row.id, row.removalId]));
  return new Map(batches.map(batch => [batch.id, batch.productionEmissionsClaimedByRemovalId
    ?? reservedRemovals.get(batch.productionEmissionsClaimReservedBySubmissionId ?? "") ?? null]));
}
