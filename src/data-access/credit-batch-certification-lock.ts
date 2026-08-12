import { and, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  certificationSubmissions,
  certifierRemovals,
} from "@/db/schema/certification";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { formatCertificationLineageLockMessage } from "./certification-lineage-lock-message";

const CERTIFIER_PROVIDER = "isometric" as const;
const REMOVAL_SCOPED_SUBMISSION_TYPES = ["removal", "dataUpload"] as const;

export async function isCreditBatchMembershipLockedBySubmission(
  ctx: OrgContext,
  tx: DbTransaction,
  removalId: string | null,
): Promise<boolean> {
  if (!removalId) return false;

  const [removal] = await tx
    .select({
      id: certifierRemovals.id,
      ghgStatementId: certifierRemovals.ghgStatementId,
    })
    .from(certifierRemovals)
    .where(
      and(
        eq(certifierRemovals.id, removalId),
        eq(certifierRemovals.organizationId, ctx.organizationId),
      ),
    )
    .for("update")
    .limit(1);
  if (!removal) return false;

  await acquireCertificationArtifactLocksSorted(tx, [
    {
      provider: CERTIFIER_PROVIDER,
      localEntityType: "removal",
      localEntityId: removal.id,
    },
    ...(removal.ghgStatementId
      ? [
          {
            provider: CERTIFIER_PROVIDER,
            localEntityType: "ghgStatement",
            localEntityId: removal.ghgStatementId,
          },
        ]
      : []),
  ]);

  const [removalSubmission] = await tx
    .select({ id: certificationSubmissions.id })
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, CERTIFIER_PROVIDER),
        eq(certificationSubmissions.localEntityType, "removal"),
        eq(certificationSubmissions.localEntityId, removal.id),
        inArray(
          certificationSubmissions.submissionType,
          REMOVAL_SCOPED_SUBMISSION_TYPES,
        ),
        inArray(
          certificationSubmissions.status,
          BLOCKING_SUBMISSION_STATUSES,
        ),
        eq(
          certificationSubmissions.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .limit(1);

  let ghgStatementSubmission:
    | { id: (typeof certificationSubmissions.$inferSelect)["id"] }
    | undefined;
  if (removal.ghgStatementId) {
    [ghgStatementSubmission] = await tx
      .select({ id: certificationSubmissions.id })
      .from(certificationSubmissions)
      .where(
        and(
          eq(certificationSubmissions.provider, CERTIFIER_PROVIDER),
          eq(certificationSubmissions.localEntityType, "ghgStatement"),
          eq(certificationSubmissions.submissionType, "ghg_statement"),
          eq(
            certificationSubmissions.localEntityId,
            removal.ghgStatementId,
          ),
          inArray(
            certificationSubmissions.status,
            BLOCKING_SUBMISSION_STATUSES,
          ),
          eq(
            certificationSubmissions.organizationId,
            ctx.organizationId,
          ),
        ),
      )
      .limit(1);
  }

  return Boolean(removalSubmission || ghgStatementSubmission);
}

export async function assertRemovalAllowsCreditBatchMutation(
  ctx: OrgContext,
  tx: DbTransaction,
  removalId: string | null,
  mutation: "update" | "delete",
): Promise<void> {
  if (
    !(await isCreditBatchMembershipLockedBySubmission(
      ctx,
      tx,
      removalId,
    ))
  ) {
    return;
  }

  throw new SafeError(
    formatCertificationLineageLockMessage({
      mutation,
      subjectEntityType: "creditBatch",
      lineageEntityType: "creditBatch",
    }),
  );
}
