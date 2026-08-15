import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creditBatchApplications, creditBatches } from "@/db/schema";
import { certifierRemovals } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

export interface CreditBatchCertificationLink {
  id: string;
  facilityId: string;
  removalId: string | null;
  ghgStatementId: string | null;
}

export async function listCreditBatchCertificationLinks(
  ctx: OrgContext,
  batchIds: string[],
): Promise<CreditBatchCertificationLink[]> {
  requireOrgScope(ctx);
  if (batchIds.length === 0) return [];

  const rows = await db
    .select({
      id: creditBatches.id,
      facilityId: creditBatches.facilityId,
      removalId: creditBatchApplications.removalId,
      ghgStatementId: certifierRemovals.ghgStatementId,
    })
    .from(creditBatches)
    .leftJoin(
      creditBatchApplications,
      and(
        eq(creditBatchApplications.creditBatchId, creditBatches.id),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      certifierRemovals,
      and(
        eq(creditBatchApplications.removalId, certifierRemovals.id),
        eq(certifierRemovals.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(creditBatches.id, batchIds),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(certifierRemovals.createdAt));

  return batchIds.flatMap((batchId) => {
    const candidates = rows.filter((row) => row.id === batchId);
    const unassigned = candidates.find((row) => row.removalId == null);
    return unassigned ? [unassigned] : candidates.slice(0, 1);
  });
}
