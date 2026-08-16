import { and, desc, eq, inArray, sql } from "drizzle-orm";
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

  return db
    .selectDistinct({
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
    .orderBy(
      sql`${certifierRemovals.createdAt} desc nulls last`,
      desc(certifierRemovals.id),
    );
}
