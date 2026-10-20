import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierRemovals } from "@/db/schema/certification";
import { creditBatchApplications } from "@/db/schema/credits";
import type { OrgContext } from "@/lib/auth/server";
import { ISOMETRIC_PROVIDER, REMOVAL_ENTITY_TYPE } from "@/lib/isometric/utils/constants";
import { FINALIZED_SUBMISSION_STATUSES } from "./certification-submissions";
import { requireOrgScope } from "./utils";

/** Slice holders that deletion refuses, including the Removal being evaluated. */
export async function getCreditBatchUndeletableRemovalCodes(
  ctx: OrgContext,
  creditBatchIds: string[],
): Promise<Map<string, string[]>> {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return new Map();

  // Match certifier-removal-deletion: statement membership or any finalized
  // ledger version. The current record-lock level cannot establish deletability.
  // The parity test in tests/credit-batch-span-removal-holders.test.ts guards this rule.
  const holders = await db.selectDistinct({
    creditBatchId: creditBatchApplications.creditBatchId,
    removalCode: certifierRemovals.code,
  }).from(creditBatchApplications)
    .innerJoin(certifierRemovals, and(
      eq(certifierRemovals.id, creditBatchApplications.removalId),
      eq(certifierRemovals.organizationId, ctx.organizationId),
    ))
    .leftJoin(certificationSubmissions, and(
      eq(certificationSubmissions.localEntityId, certifierRemovals.id),
      eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.provider, ISOMETRIC_PROVIDER),
      eq(certificationSubmissions.submissionType, REMOVAL_ENTITY_TYPE),
      eq(certificationSubmissions.localEntityType, REMOVAL_ENTITY_TYPE),
      inArray(certificationSubmissions.status, [...FINALIZED_SUBMISSION_STATUSES]),
    ))
    .where(and(
      eq(creditBatchApplications.organizationId, ctx.organizationId),
      inArray(creditBatchApplications.creditBatchId, creditBatchIds),
      or(isNotNull(certifierRemovals.ghgStatementId), isNotNull(certificationSubmissions.id)),
    ))
    .orderBy(creditBatchApplications.creditBatchId, certifierRemovals.code);

  const codesByBatch = new Map<string, string[]>();
  for (const holder of holders) {
    const codes = codesByBatch.get(holder.creditBatchId) ?? [];
    codes.push(holder.removalCode);
    codesByBatch.set(holder.creditBatchId, codes);
  }
  return codesByBatch;
}
