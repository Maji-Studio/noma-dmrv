import { and, eq, inArray } from "drizzle-orm";
import type { db, DbTransaction } from "@/db";
import { certificationSubmissions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { canTransferProductionReservation, isIsometricRemovalSubmission } from "@/lib/certification/production-reservation-policy";
import { listProductionClaimDraftContenders } from "./certifier-removals";
import { requireOrgScope } from "./utils";

/** Read the same protected reservations and ordered attempts the submission gates use. */
export async function loadAllocationProductionClaims(ctx: OrgContext,
  batches: { id: string; productionEmissionsClaimReservedBySubmissionId: string | null }[],
  executor: typeof db | DbTransaction,
) {
  requireOrgScope(ctx);
  const ids = batches.flatMap(batch => batch.productionEmissionsClaimReservedBySubmissionId ? [batch.productionEmissionsClaimReservedBySubmissionId] : []);
  const [reservations, productionContenders] = await Promise.all([
    ids.length ? executor.select({ id: certificationSubmissions.id, provider: certificationSubmissions.provider,
      submissionType: certificationSubmissions.submissionType, localEntityType: certificationSubmissions.localEntityType,
      localEntityId: certificationSubmissions.localEntityId, status: certificationSubmissions.status,
      lockedAt: certificationSubmissions.lockedAt, metadata: certificationSubmissions.metadata,
    }).from(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId),
      inArray(certificationSubmissions.id, ids))) : [],
    listProductionClaimDraftContenders(ctx, batches.map(batch => batch.id), executor),
  ]);
  const productionReservations: Record<string, string | null> = {};
  const nowMs = Date.now();
  for (const batch of batches) {
    const id = batch.productionEmissionsClaimReservedBySubmissionId;
    if (!id) continue;
    const row = reservations.find(row => row.id === id);
    if (canTransferProductionReservation(row, nowMs)) continue;
    productionReservations[batch.id] = row && isIsometricRemovalSubmission(row) ? row.localEntityId : null;
  }
  return { productionReservations, productionContenders };
}
