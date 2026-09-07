import { and, eq, isNull } from "drizzle-orm";
import { withDedicatedLockConnection } from "@/db";
import { certificationSubmissions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgRole } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { isSubmissionAttemptInterrupted, SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { requireOrgScope } from "./utils";
import { getLatestSubmissionWithExecutor } from "./certification-submissions";
import type { CertificationSubmissionRow } from "./certification";

/** Reconcile under the same artifact lock used by submission claims. */
export async function requestRemovalEvidenceRefresh(
  ctx: OrgContext,
  args: { removalId: string; submissionId: string },
  reconcile: (row: CertificationSubmissionRow) => Promise<unknown[]>,
) {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  return withDedicatedLockConnection(async (tx) => {
    const key = {
      provider: "isometric" as const,
      submissionType: "removal" as const,
      localEntityType: "removal",
      localEntityId: args.removalId,
    };
    await acquireCertificationArtifactLocksSorted(tx, [key]);
    const row = await getLatestSubmissionWithExecutor(ctx, tx, key);
    if (
      !row || row.id !== args.submissionId || row.status !== "draft" ||
      row.externalId || !isSubmissionAttemptInterrupted(row.metadata)
    ) {
      throw new SafeError("Only an interrupted attempt without a registry GHG Entry can include new evidence. Refresh the Removal and retry its saved attempt.");
    }
    const candidates = await reconcile(row);
    await tx.update(certificationSubmissions).set({
      metadata: {
        ...(row.metadata as Record<string, unknown> ?? {}),
        [SUBMISSION_METADATA_KEYS.evidenceRefreshCandidates]: candidates,
        evidenceRefreshRequestedAt: new Date().toISOString(),
        evidenceRefreshRequestedBy: ctx.userId,
      },
    }).where(and(
      eq(certificationSubmissions.id, row.id),
      eq(certificationSubmissions.organizationId, ctx.organizationId),
      eq(certificationSubmissions.status, "draft"),
      isNull(certificationSubmissions.externalId),
    ));
    return { submissionId: row.id, evidenceCount: candidates.length };
  });
}
