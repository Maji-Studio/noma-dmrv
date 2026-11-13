import { pluralize } from "@/lib/copy-utils";
import { lockActiveFacilityReference } from "./facility-reference-guards";
import { certifierBiocharApplications } from "@/db/schema/certifier-biochar-applications";
import { applications } from "@/db/schema/application";
import { ISOMETRIC_PROVIDER, REMOVAL_SUBMISSION_TYPE, REMOVAL_ENTITY_TYPE } from "@/lib/isometric/utils/constants";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { certificationSubmissions, certifierRemovals, certifierSyncEvents, certifierProjects } from "@/db/schema/certification";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { isRegistryMissingSubmission, REGISTRY_MISSING_CONFIRMED_AT, REGISTRY_MISSING_EXTERNAL_ID, REMOVAL_RESEND_OPERATION, type RemovalRegistryPresence } from "@/lib/certification/removal-registry-presence";
import { SafeError } from "@/lib/errors";
import type { RemovalResendInput } from "@/schemas/removal-resend";
import { requireOrgScope } from "./utils";
import { getLatestSubmissionWithExecutor } from "./certification-submissions";
import { isRemovalDeletionLeased } from "./removal-deletion-lease";
import { withCertificationStatusActivity } from "./certification-status-activity";

export function removalResendKey(removalId: string) {
  return { provider: ISOMETRIC_PROVIDER, submissionType: REMOVAL_SUBMISSION_TYPE, localEntityType: REMOVAL_ENTITY_TYPE, localEntityId: removalId } as const;
}

/** Read the current mapping through the caller's executor, including under retirement's lock. */
export async function getRemovalResendProjectId(
  ctx: OrgContext,
  facilityId: string,
  payloadSnapshot: unknown,
  executor: typeof db | DbTransaction = db,
): Promise<string | null> {
  requireOrgScope(ctx);
  const [project] = await executor.select({ externalProjectId: certifierProjects.externalProjectId })
    .from(certifierProjects).where(and(
      eq(certifierProjects.organizationId, ctx.organizationId),
      eq(certifierProjects.facilityId, facilityId),
      eq(certifierProjects.provider, ISOMETRIC_PROVIDER),
    ));
  const snapshot = payloadSnapshot as { semantic?: { externalProjectId?: unknown } } | null;
  return project?.externalProjectId && project.externalProjectId === snapshot?.semantic?.externalProjectId
    ? project.externalProjectId : null;
}

/** Keep the same artifact lock as submit through the confirming GET and atomic retirement. */
export async function retireMissingRemovalSubmission(
  ctx: OrgContext,
  input: RemovalResendInput,
  check: (externalId: string, externalProjectId: string) => Promise<RemovalRegistryPresence>,
  checkApplication: (externalId: string) => Promise<RemovalRegistryPresence>,
): Promise<{ removalId: string; previousVersion: number; prepared: boolean }> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  return db.transaction(async (tx) => {
    await lockActiveFacilityReference(ctx, tx, input.facilityId);
    const key = removalResendKey(input.removalId);
    const [removal] = await tx.select({ id: certifierRemovals.id }).from(certifierRemovals).where(and(
      eq(certifierRemovals.id, input.removalId), eq(certifierRemovals.facilityId, input.facilityId),
      eq(certifierRemovals.organizationId, ctx.organizationId),
    )).for("update");
    if (!removal) throw new SafeError("Removal does not belong to requested facility.");
    await acquireCertificationArtifactLocksSorted(tx, [key]);
    if (await isRemovalDeletionLeased(ctx, key, tx)) throw new SafeError("This Removal is being deleted. Wait, then try again.");
    const latest = await getLatestSubmissionWithExecutor(ctx, tx, key, input.facilityId);
    const alreadyRetired = isRegistryMissingSubmission(latest);
    if (!latest || (latest.status !== "submitted" && !alreadyRetired) || !latest.externalId || latest.lockedAt) {
      throw new SafeError("This Removal has no completed submission to send again. Refresh its status.");
    }
    const projectId = await getRemovalResendProjectId(ctx, input.facilityId, latest.payloadSnapshot, tx);
    const presence = projectId ? await check(latest.externalId, projectId) : "unknown";
    if (presence !== "missing") throw new SafeError(presence === "present"
      ? "This Removal is still in Isometric. Refresh its status."
      : "Isometric could not confirm whether this Removal exists. Try again.");
    if (alreadyRetired) return { removalId: input.removalId, previousVersion: latest.version, prepared: false };
    const registrations = await tx.select({
      externalId: certifierBiocharApplications.externalApplicationId,
      code: applications.code,
    }).from(certifierBiocharApplications).innerJoin(applications, and(
      eq(applications.id, certifierBiocharApplications.applicationId),
      eq(applications.organizationId, ctx.organizationId),
    )).where(and(
      eq(certifierBiocharApplications.organizationId, ctx.organizationId),
      eq(certifierBiocharApplications.removalSubmissionId, latest.id),
    ));
    const present: string[] = [];
    let unknown = false;
    for (const registration of registrations) {
      if (!registration.externalId) continue;
      const applicationPresence = await checkApplication(registration.externalId);
      if (applicationPresence === "present") present.push(registration.code);
      if (applicationPresence === "unknown") unknown = true;
    }
    if (present.length) {
      const codes = [...new Set(present)].sort();
      const labels = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(codes);
      throw new SafeError(`${pluralize(codes.length, "Application")} ${labels} ${pluralize(codes.length, "is", "are")} still in Isometric. Delete ${pluralize(codes.length, "it", "them")} in Certify, then press Send again.`);
    }
    if (unknown) throw new SafeError("Isometric did not confirm that every Application is gone. Try again.");
    const metadata = { ...(latest.metadata as Record<string, unknown> | null), [REGISTRY_MISSING_CONFIRMED_AT]: new Date().toISOString(), [REGISTRY_MISSING_EXTERNAL_ID]: latest.externalId };
    await withCertificationStatusActivity(ctx, [latest.id], async (tx) => {
      await tx.update(certificationSubmissions).set({ status: "superseded", metadata, supersededAt: sql`now()`, updatedAt: sql`now()` }).where(and(
        eq(certificationSubmissions.id, latest.id), eq(certificationSubmissions.organizationId, ctx.organizationId),
      ));
    }, tx);
    // A definitively absent Removal cannot belong to a remote statement. Keep
    // its external identity and submittedAt in the ledger so Sent locks hold.
    await tx.update(certifierRemovals).set({ ghgStatementId: null, updatedAt: sql`now()` }).where(and(
      eq(certifierRemovals.id, input.removalId), eq(certifierRemovals.organizationId, ctx.organizationId),
    ));
    await tx.insert(certifierSyncEvents).values({ organizationId: ctx.organizationId,
      provider: key.provider, entityType: key.localEntityType, entityId: input.removalId,
      operation: REMOVAL_RESEND_OPERATION, status: "succeeded",
      responsePayload: { submissionId: latest.id, previousVersion: latest.version, ...metadata },
    });
    return { removalId: input.removalId, previousVersion: latest.version, prepared: true };
  });
}
