import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
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
    .select({
      id: creditBatches.id,
      facilityId: creditBatches.facilityId,
      removalId: creditBatches.removalId,
      ghgStatementId: certifierRemovals.ghgStatementId,
    })
    .from(creditBatches)
    .leftJoin(
      certifierRemovals,
      and(
        eq(creditBatches.removalId, certifierRemovals.id),
        eq(certifierRemovals.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(creditBatches.id, batchIds),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    );
}
