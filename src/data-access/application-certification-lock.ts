import { db } from "@/db";
import { applications } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";
import { getLockedCertifiedLineage } from "./certification-lineage-guards";

export async function getApplicationCertificationLock(ctx: OrgContext, applicationId: string) {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, applications, applicationId);
  return db.transaction(async (tx) => {
    const rows = await getLockedCertifiedLineage(ctx, tx, { entityType: "application", entityId: applicationId });
    return rows.some((row) => row.removalSubmissionId || row.ghgStatementSubmissionId);
  });
}
