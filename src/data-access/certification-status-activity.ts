import { and, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatchApplications } from "@/db/schema/credits";
import { certificationSubmissions, certifierRemovals } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import { toActivityEntityType } from "@/lib/activity-entity-type";
import { SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
import { recordActivity, type ActivityEventInput } from "./activity-events";
import { requireOrgScope } from "./utils";

export interface CertificationActivityOrigin {
  source: Extract<ActivityEventInput["source"], "form" | "registry">;
  registryAt?: ActivityEventInput["registryAt"];
}

/** Lock before reading so concurrent writers record the actual predecessor. */
export async function withCertificationStatusActivity(
  ctx: OrgContext,
  ids: string[],
  write: (tx: DbTransaction) => Promise<void>,
  callerTx?: DbTransaction,
  origin: CertificationActivityOrigin = { source: "form" },
): Promise<void> {
  requireOrgScope(ctx);
  const run = async (tx: DbTransaction) => {
    const before = await tx.select().from(certificationSubmissions)
      .where(and(
        inArray(certificationSubmissions.id, ids),
        eq(certificationSubmissions.organizationId, ctx.organizationId),
      )).orderBy(certificationSubmissions.id).for("update");
    await write(tx);
    const after = await tx.select().from(certificationSubmissions).where(and(
      inArray(certificationSubmissions.id, ids),
      eq(certificationSubmissions.organizationId, ctx.organizationId),
    ));
    for (const row of after) {
      const previous = before.find((candidate) => candidate.id === row.id);
      if (!previous) continue;
      const fromRemote = remoteStatus(previous.metadata);
      const toRemote = remoteStatus(row.metadata);
      if (previous.status === row.status && fromRemote === toRemote) continue;
      const entityType = toActivityEntityType(row.localEntityType);
      await recordActivity(ctx, tx, {
        entityType,
        entityId: row.localEntityId,
        action: "status_changed",
        fromStatus: previous.status,
        toStatus: row.status,
        fromRemote,
        toRemote,
        submissionRef: {
          provider: row.provider,
          submissionType: row.submissionType,
          submissionId: row.id,
          version: row.version,
        },
        creditBatchId: await submissionCreditBatchId(ctx, tx, entityType, row.localEntityId),
        productionRunId: entityType === "production_run" ? row.localEntityId : null,
        source: origin.source,
        registryAt: origin.registryAt ?? null,
      });
    }
  };
  await (callerTx ? run(callerTx) : db.transaction(run));
}

function remoteStatus(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[SUBMISSION_METADATA_KEYS.remoteStatus];
  return typeof value === "string" ? value : null;
}

// Aggregate submissions have a batch anchor only when their membership is singular.
async function submissionCreditBatchId(
  ctx: OrgContext,
  tx: DbTransaction,
  entityType: ActivityEventInput["entityType"],
  entityId: string,
): Promise<string | null> {
  requireOrgScope(ctx);
  if (entityType === "credit_batch") return entityId;
  if (entityType !== "removal" && entityType !== "ghg_statement") return null;
  const batches = await tx.selectDistinct({ id: creditBatchApplications.creditBatchId })
    .from(creditBatchApplications)
    .innerJoin(certifierRemovals, and(
      eq(certifierRemovals.id, creditBatchApplications.removalId),
      eq(certifierRemovals.organizationId, ctx.organizationId),
    ))
    .where(and(
      eq(creditBatchApplications.organizationId, ctx.organizationId),
      entityType === "removal"
        ? eq(certifierRemovals.id, entityId)
        : eq(certifierRemovals.ghgStatementId, entityId),
    ));
  return batches.length === 1 ? batches[0].id : null;
}
