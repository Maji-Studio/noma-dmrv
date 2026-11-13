import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierRemovals, certifierSyncEvents } from "@/db/schema/certification";
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
  return { provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: removalId } as const;
}

/** Keep the same artifact lock as submit through the confirming GET and atomic retirement. */
export async function retireMissingRemovalSubmission(
  ctx: OrgContext,
  input: RemovalResendInput,
  check: (externalId: string) => Promise<RemovalRegistryPresence>,
): Promise<{ removalId: string; previousVersion: number; prepared: boolean }> {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  return db.transaction(async (tx) => {
    const key = removalResendKey(input.removalId);
    const [removal] = await tx.select({ id: certifierRemovals.id }).from(certifierRemovals).where(and(
      eq(certifierRemovals.id, input.removalId), eq(certifierRemovals.facilityId, input.facilityId),
      eq(certifierRemovals.organizationId, ctx.organizationId),
    )).for("update");
    if (!removal) throw new SafeError("Removal does not belong to requested facility.");
    await acquireCertificationArtifactLocksSorted(tx, [key]);
    if (await isRemovalDeletionLeased(ctx, key, tx)) throw new SafeError("This Removal is being deleted. Wait, then try again.");
    const latest = await getLatestSubmissionWithExecutor(ctx, tx, key, input.facilityId);
    if (latest && isRegistryMissingSubmission(latest)) {
      return { removalId: input.removalId, previousVersion: latest.version, prepared: false };
    }
    if (!latest || latest.status !== "submitted" || !latest.externalId || latest.lockedAt) {
      throw new SafeError("This Removal has no completed submission to send again. Refresh its status.");
    }
    const presence = await check(latest.externalId);
    if (presence !== "missing") throw new SafeError(presence === "present"
      ? "This Removal is still in Isometric. Refresh its status."
      : "Isometric could not confirm whether this Removal exists. Try again.");
    const metadata = { ...(latest.metadata as Record<string, unknown> | null), [REGISTRY_MISSING_CONFIRMED_AT]: new Date().toISOString(), [REGISTRY_MISSING_EXTERNAL_ID]: latest.externalId };
    await withCertificationStatusActivity(ctx, [latest.id], async (tx) => {
      await tx.update(certificationSubmissions).set({ status: "superseded", metadata, updatedAt: sql`now()` }).where(and(
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
