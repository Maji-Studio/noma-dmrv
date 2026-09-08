import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { certificationSubmissions, certifierProjects } from "@/db/schema/certification";
import { certifierProductionBatches } from "@/db/schema/certifier-production-batches";
import { certifierBiocharApplications } from "@/db/schema/certifier-biochar-applications";
import { creditBatchApplications, creditBatches } from "@/db/schema/credits";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { buildProductionBatchReference } from "@/lib/isometric/production-batches";
import { requireOrgScope } from "./utils";
import type { RemovalDeletionClaim } from "./certifier-removal-deletion";

export interface RemovalProductionBatch {
  creditBatchId: string;
  registrationId: string | null;
  externalProductionBatchId: string | null;
  supplierReference: string;
  externalFacilityId: string | null;
  registrationUpdatedAt?: Date | null;
  registrationPayloadHash?: string | null;
}
export interface ProductionBatchDeletionOutcome {
  creditBatchId: string;
  externalId: string | null;
  outcome: "deleted" | "absent" | "retained";
}

export async function removalProductionBatchTargets(ctx: OrgContext, removalId: string, tx: DbTransaction): Promise<RemovalProductionBatch[]> {
  requireOrgScope(ctx);
  const rows = await tx.select({ creditBatchId: creditBatchApplications.creditBatchId,
    registrationId: certifierProductionBatches.id,
    registrationUpdatedAt: certifierProductionBatches.updatedAt,
    registrationPayloadHash: certifierProductionBatches.payloadHash,
    externalProductionBatchId: certifierProductionBatches.externalProductionBatchId,
    supplierReference: certifierProductionBatches.supplierReference,
    registeredFacilityId: certifierProductionBatches.externalFacilityId,
    externalFacilityId: certifierProjects.externalFacilityId,
  }).from(creditBatchApplications)
    .innerJoin(creditBatches, and(eq(creditBatches.id, creditBatchApplications.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)))
    .leftJoin(certifierProductionBatches, and(eq(certifierProductionBatches.creditBatchId, creditBatches.id), eq(certifierProductionBatches.organizationId, ctx.organizationId)))
    .leftJoin(certifierProjects, and(eq(certifierProjects.facilityId, creditBatches.facilityId), eq(certifierProjects.provider, "isometric"), eq(certifierProjects.organizationId, ctx.organizationId)))
    .where(and(eq(creditBatchApplications.removalId, removalId), eq(creditBatchApplications.organizationId, ctx.organizationId)));
  return [...new Map(rows.map((row) => {
    const supplierReference = buildProductionBatchReference({ creditBatchId: row.creditBatchId });
    if (row.supplierReference && row.supplierReference !== supplierReference) throw new SafeError("The saved production batch reference has changed. Ask support to check it before deleting the Removal.");
    return [row.creditBatchId, { ...row, supplierReference,
      externalFacilityId: row.registrationId ? row.registeredFacilityId : row.externalFacilityId }];
  })).values()];
}

/** Fresh check before the remote DELETE and again under the finalization transaction. */
export async function isRemovalProductionBatchShared(ctx: OrgContext, claim: RemovalDeletionClaim, target: RemovalProductionBatch, tx: DbTransaction | typeof db = db): Promise<boolean> {
  requireOrgScope(ctx);
  const memberships = await tx.select({ removalId: creditBatchApplications.removalId })
    .from(creditBatchApplications).where(and(eq(creditBatchApplications.creditBatchId, target.creditBatchId),
      ne(creditBatchApplications.removalId, claim.removalId), eq(creditBatchApplications.organizationId, ctx.organizationId))).limit(1);
  if (memberships.length) return true;
  const registrations = await tx.select({ submissionId: certifierBiocharApplications.removalSubmissionId })
    .from(certifierBiocharApplications).where(and(eq(certifierBiocharApplications.creditBatchId, target.creditBatchId), eq(certifierBiocharApplications.organizationId, ctx.organizationId)));
  if (registrations.some((row) => !claim.submissionIds.includes(row.submissionId))) return true;
  const [batch] = await tx.select({ reservation: creditBatches.productionEmissionsClaimReservedBySubmissionId,
    owner: creditBatches.productionEmissionsClaimedByRemovalId }).from(creditBatches)
    .where(and(eq(creditBatches.id, target.creditBatchId), eq(creditBatches.organizationId, ctx.organizationId)));
  if (!batch) throw new SafeError("The credit batch changed during deletion. Try again.");
  if ((batch.reservation && !claim.submissionIds.includes(batch.reservation)) || (batch.owner && batch.owner !== claim.removalId)) return true;
  const submissions = await tx.select({ id: certificationSubmissions.id, payloadSnapshot: certificationSubmissions.payloadSnapshot, metadata: certificationSubmissions.metadata })
    .from(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.provider, "isometric")));
  return submissions.some((row) => {
    if (claim.submissionIds.includes(row.id)) return false;
    const metadata = row.metadata as { deletion?: unknown } | null;
    if (metadata?.deletion) return false;
    return containsIdentity(row.payloadSnapshot, target.creditBatchId) ||
      (target.externalProductionBatchId !== null && containsIdentity(row.payloadSnapshot, target.externalProductionBatchId));
  });
}

function containsIdentity(value: unknown, identity: string): boolean {
  if (value === identity) return true;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((child) => containsIdentity(child, identity));
}

export async function clearDeletedRemovalProductionBatches(ctx: OrgContext, claim: RemovalDeletionClaim, outcomes: ProductionBatchDeletionOutcome[], tx: DbTransaction): Promise<void> {
  requireOrgScope(ctx);
  for (const target of claim.productionBatches ?? []) {
    const outcome = outcomes.find((item) => item.creditBatchId === target.creditBatchId);
    if (!outcome || (target.externalProductionBatchId && outcome.externalId !== target.externalProductionBatchId)) {
      throw new SafeError("Production batch cleanup is not confirmed. Run Delete Removal again.");
    }
    if (outcome.outcome === "retained") continue;
    if (await isRemovalProductionBatchShared(ctx, claim, target, tx)) {
      throw new SafeError("The production batch became shared during registry cleanup. Its saved registration is kept. Try again so the shared Removal can recover the registry batch.");
    }
    if (!target.registrationId) {
      const registrations = await tx.select({ id: certifierProductionBatches.id })
        .from(certifierProductionBatches).where(and(
          eq(certifierProductionBatches.organizationId, ctx.organizationId),
          eq(certifierProductionBatches.provider, "isometric"),
          eq(certifierProductionBatches.creditBatchId, target.creditBatchId),
        )).limit(1);
      if (registrations.length) throw new SafeError("A production batch registration appeared during cleanup. Run Delete Removal again.");
      continue;
    }
    const removed = await tx.delete(certifierProductionBatches).where(and(
      eq(certifierProductionBatches.organizationId, ctx.organizationId),
      eq(certifierProductionBatches.provider, "isometric"),
      eq(certifierProductionBatches.id, target.registrationId),
      target.registrationUpdatedAt ? sql`date_trunc('milliseconds', ${certifierProductionBatches.updatedAt}) = ${target.registrationUpdatedAt.toISOString()}::timestamp` : undefined,
      target.registrationPayloadHash ? eq(certifierProductionBatches.payloadHash, target.registrationPayloadHash) : undefined,
      eq(certifierProductionBatches.creditBatchId, target.creditBatchId),
      eq(certifierProductionBatches.externalProductionBatchId, target.externalProductionBatchId!),
      eq(certifierProductionBatches.supplierReference, target.supplierReference),
      sql`${certifierProductionBatches.externalFacilityId} is not distinct from ${target.externalFacilityId}`,
    )).returning({ id: certifierProductionBatches.id });
    if (!removed.length) throw new SafeError("The saved production batch changed during deletion. Try again.");
  }
}

/** Called while createRemoval holds the selected credit-batch row locks. */
export async function assertNoRemovalBatchDeletion(ctx: OrgContext, creditBatchIds: string[], tx: DbTransaction): Promise<void> {
  requireOrgScope(ctx);
  if (!creditBatchIds.length) return;
  const rows = await tx.select({ id: certificationSubmissions.id }).from(creditBatchApplications)
    .innerJoin(certificationSubmissions, and(eq(certificationSubmissions.localEntityId, creditBatchApplications.removalId), eq(certificationSubmissions.organizationId, ctx.organizationId)))
    .where(and(inArray(creditBatchApplications.creditBatchId, creditBatchIds), eq(creditBatchApplications.organizationId, ctx.organizationId),
      sql`${certificationSubmissions.metadata}->>'lastAttemptOutcome' = 'deleting'`)).limit(1);
  if (rows.length) throw new SafeError("A Removal using this credit batch is being deleted. Finish that cleanup before creating another Removal.");
}
