import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  certificationSubmissions,
  certifierRemovals,
} from "@/db/schema/certification";
import { creditBatchApplications } from "@/db/schema/credits";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { formatCertificationLineageLockMessage } from "@/lib/certification/lineage-lock-message";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";

const CERTIFIER_PROVIDER = "isometric" as const;
const REMOVAL_SCOPED_SUBMISSION_TYPES = ["removal", "dataUpload"] as const;

export async function isCreditBatchMembershipLockedBySubmission(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
): Promise<boolean> {
  const removalRows = await tx
    .select({
      id: certifierRemovals.id,
      ghgStatementId: certifierRemovals.ghgStatementId,
    })
    .from(creditBatchApplications)
    .innerJoin(
      certifierRemovals,
      and(
        eq(certifierRemovals.id, creditBatchApplications.removalId),
        eq(certifierRemovals.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(creditBatchApplications.creditBatchId, creditBatchId),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(certifierRemovals.id)
    .for("update");
  const removals = [
    ...new Map(removalRows.map((removal) => [removal.id, removal])).values(),
  ];
  if (removals.length === 0) return false;

  await acquireCertificationArtifactLocksSorted(tx, [
    ...removals.map((removal) => ({
      provider: CERTIFIER_PROVIDER,
      localEntityType: "removal",
      localEntityId: removal.id,
    } as const)),
    ...removals
      .filter((removal) => removal.ghgStatementId)
      .map((removal) => ({
        provider: CERTIFIER_PROVIDER,
        localEntityType: "ghgStatement",
        localEntityId: removal.ghgStatementId!,
      } as const)),
  ]);

  const removalIds = removals.map((removal) => removal.id);

  const [removalSubmission] = await tx
    .select({ id: certificationSubmissions.id })
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, CERTIFIER_PROVIDER),
        eq(certificationSubmissions.localEntityType, "removal"),
        inArray(certificationSubmissions.localEntityId, removalIds),
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

  const ghgStatementIds = removals
    .map((removal) => removal.ghgStatementId)
    .filter((id): id is string => Boolean(id));
  let ghgStatementSubmission:
    | { id: (typeof certificationSubmissions.$inferSelect)["id"] }
    | undefined;
  if (ghgStatementIds.length > 0) {
    [ghgStatementSubmission] = await tx
      .select({ id: certificationSubmissions.id })
      .from(certificationSubmissions)
      .where(
        and(
          eq(certificationSubmissions.provider, CERTIFIER_PROVIDER),
          eq(certificationSubmissions.localEntityType, "ghgStatement"),
          eq(certificationSubmissions.submissionType, "ghg_statement"),
          inArray(certificationSubmissions.localEntityId, ghgStatementIds),
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
  creditBatchId: string,
  mutation: "update" | "delete",
): Promise<void> {
  if (
    !(await isCreditBatchMembershipLockedBySubmission(
      ctx,
      tx,
      creditBatchId,
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

export async function assertCreditBatchSlicesAreUnassigned(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
): Promise<void> {
  const [assignedSlice] = await tx
    .select({ applicationId: creditBatchApplications.applicationId })
    .from(creditBatchApplications)
    .where(
      and(
        eq(creditBatchApplications.creditBatchId, creditBatchId),
        isNotNull(creditBatchApplications.removalId),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    )
    .for("update")
    .limit(1);
  if (!assignedSlice) return;

  throw new SafeError(
    "Cannot change this credit batch's production membership because its applied mass belongs to a Removal.",
  );
}
