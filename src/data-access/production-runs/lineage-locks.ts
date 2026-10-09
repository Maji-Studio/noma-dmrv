import { and, eq, isNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { certificationArtifactLockKey } from "@/lib/certification/submission-lock";
import type { ProductionRunStatus } from "@/lib/production-runs/lifecycle";
import { getLockedCertifiedLineages, type CertifiedLineageTarget } from "../certification-lineage-guards";
import { requireOrgScope } from "../utils";

/** Include prospective membership so completing/creating a run cannot lock lineage after bins. */
export async function lockProductionRunLineage(
  ctx: OrgContext,
  tx: DbTransaction,
  input: { productionRunId?: string; facilityId: string; status: ProductionRunStatus },
): Promise<ReadonlySet<string>> {
  requireOrgScope(ctx);
  const targets: CertifiedLineageTarget[] = input.productionRunId
    ? [{ entityType: "productionRun", entityId: input.productionRunId }]
    : [];
  const lineage = await getLockedCertifiedLineages(ctx, tx, targets);
  if (input.status === "complete") {
    // Type/date membership is resolved after allocation. Lock the facility's
    // prospective cohorts without waiting, then skip new artifacts at attachment.
    const batches = await tx.select({ id: creditBatches.id }).from(creditBatches)
      .where(and(eq(creditBatches.organizationId, ctx.organizationId),
        eq(creditBatches.facilityId, input.facilityId), isNull(creditBatches.archivedAt)));
    lineage.push(...await getLockedCertifiedLineages(ctx, tx,
      batches.map(({ id }) => ({ entityType: "creditBatch" as const, entityId: id })), true));
  }
  return new Set(lineage.flatMap((row) => [
    certificationArtifactLockKey({ provider: "isometric", localEntityType: "removal", localEntityId: row.removalId }),
    ...(row.ghgStatementId ? [certificationArtifactLockKey({ provider: "isometric", localEntityType: "ghgStatement", localEntityId: row.ghgStatementId })] : []),
  ]));
}
