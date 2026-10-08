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
import { requireOrgScope } from "./utils";

const CERTIFIER_PROVIDER = "isometric" as const;
const REMOVAL_SCOPED_SUBMISSION_TYPES = ["removal", "dataUpload"] as const;

async function readCreditBatchRemovals(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
  lock = false,
) {
  requireOrgScope(ctx);
  const query = tx
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
    .orderBy(certifierRemovals.id);
  // Keep lineage stable without waiting on a Removal lifecycle transaction
  // that may hold its row while waiting for our artifact lock. An incomplete
  // result fails the snapshot comparison below and asks the caller to retry.
  const removalRows = await (lock ? query.for("update", { skipLocked: true }) : query);
  const removals = [
    ...new Map(removalRows.map((removal) => [removal.id, removal])).values(),
  ];
  return removals;
}

type CreditBatchRemovals = Awaited<ReturnType<typeof readCreditBatchRemovals>>;

/** Acquire artifacts from an unlocked read, before taking any batch row lock. */
export async function lockCreditBatchArtifacts(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
): Promise<CreditBatchRemovals> {
  const removals = await readCreditBatchRemovals(ctx, tx, creditBatchId);
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

  return removals;
}

/** Re-resolve under the batch lock; never acquire newly discovered artifacts here. */
export async function isCreditBatchMembershipLockedBySubmission(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
  lockedRemovals: CreditBatchRemovals,
): Promise<boolean> {
  const removals = await readCreditBatchRemovals(ctx, tx, creditBatchId, true);
  if (
    removals.length !== lockedRemovals.length ||
    removals.some((removal, index) =>
      removal.id !== lockedRemovals[index].id ||
      removal.ghgStatementId !== lockedRemovals[index].ghgStatementId,
    )
  ) {
    throw new SafeError("Certification lineage changed while it was being locked. Refresh and retry.");
  }
  if (removals.length === 0) return false;
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
  lockedRemovals: CreditBatchRemovals,
): Promise<void> {
  if (
    !(await isCreditBatchMembershipLockedBySubmission(
      ctx,
      tx,
      creditBatchId,
      lockedRemovals,
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
